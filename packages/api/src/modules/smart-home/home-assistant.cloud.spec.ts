jest.mock("@buildingai/errors", () => ({
    HttpErrorFactory: {
        badRequest: (message: string) => new Error(message),
        unauthorized: (message: string) => new Error(message),
        badGateway: (message: string) => new Error(message),
        notFound: (message: string) => new Error(message),
    },
}));

import { HomeAssistantCloudClient, homeAssistantOAuthClientId } from "./home-assistant.cloud";

describe("home-assistant password login", () => {
    const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>();

    beforeEach(() => {
        fetchMock.mockReset();
        global.fetch = fetchMock as unknown as typeof fetch;
    });

    it("uses HA login flow + authorization_code instead of grant_type=password", async () => {
        fetchMock
            .mockResolvedValueOnce(
                jsonResponse([{ type: "homeassistant", id: null }]),
            )
            .mockResolvedValueOnce(jsonResponse({ flow_id: "flow-1", type: "form", step_id: "init" }))
            .mockResolvedValueOnce(jsonResponse({ type: "create_entry", result: "auth-code-1" }))
            .mockResolvedValueOnce(
                jsonResponse({
                    access_token: "access-1",
                    refresh_token: "refresh-1",
                    expires_in: 1800,
                }),
            );

        const tokens = await HomeAssistantCloudClient.loginWithPassword(
            "http://192.168.1.10:8123",
            "admin",
            "secret",
        );

        expect(tokens.accessToken).toBe("access-1");
        expect(tokens.refreshToken).toBe("refresh-1");

        const grantBodies = fetchMock.mock.calls.map(([, init]) => String(init?.body ?? ""));
        expect(grantBodies.some((body) => body.includes("grant_type=password"))).toBe(false);

        const tokenCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/auth/token"));
        expect(tokenCall?.[0]).toBe("http://192.168.1.10:8123/auth/token");
        expect(String(tokenCall?.[1]?.body)).toContain("grant_type=authorization_code");
        expect(String(tokenCall?.[1]?.body)).toContain("code=auth-code-1");
        expect(String(tokenCall?.[1]?.body)).toContain(
            `client_id=${encodeURIComponent(homeAssistantOAuthClientId("http://192.168.1.10:8123"))}`,
        );
    });

    it("maps invalid_auth to a username/password error", async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse([{ type: "homeassistant", id: null }]))
            .mockResolvedValueOnce(jsonResponse({ flow_id: "flow-1", type: "form" }))
            .mockResolvedValueOnce(
                jsonResponse({ type: "form", errors: { base: "invalid_auth" } }),
            );

        await expect(
            HomeAssistantCloudClient.loginWithPassword("http://ha.local:8123", "admin", "bad"),
        ).rejects.toThrow("Home Assistant 用户名或密码不正确");
    });
});

function jsonResponse(payload: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(payload),
    } as Response;
}
