import { HttpErrorFactory } from "@buildingai/errors";

import { HOME_ASSISTANT_HTTP_TIMEOUT_MS } from "./home-assistant.constants";
import type { HomeAssistantStatePayload } from "./home-assistant.light";

export type HomeAssistantTokenSet = {
    accessToken: string;
    refreshToken?: string | null;
    expiresAt?: Date | null;
};

export type HomeAssistantConfig = {
    location_name?: string;
    version?: string;
    time_zone?: string;
};

export function normalizeHomeAssistantBaseUrl(value: string): string {
    const trimmed = value.trim().replace(/\/+$/, "");
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw HttpErrorFactory.badRequest("Home Assistant 地址无效");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw HttpErrorFactory.badRequest("Home Assistant 地址必须是 http 或 https");
    }
    return parsed.origin + (parsed.pathname !== "/" ? parsed.pathname.replace(/\/+$/, "") : "");
}

export function homeAssistantOAuthClientId(baseUrl: string): string {
    return `${normalizeHomeAssistantBaseUrl(baseUrl)}/`;
}

export class HomeAssistantCloudClient {
    constructor(
        private readonly baseUrl: string,
        private readonly accessToken: string,
    ) {}

    async ping(): Promise<HomeAssistantConfig> {
        return this.request<HomeAssistantConfig>("/api/config");
    }

    async listStates(): Promise<HomeAssistantStatePayload[]> {
        const states = await this.request<HomeAssistantStatePayload[]>("/api/states");
        return Array.isArray(states) ? states : [];
    }

    async getState(entityId: string): Promise<HomeAssistantStatePayload> {
        return this.request<HomeAssistantStatePayload>(
            `/api/states/${encodeURIComponent(entityId)}`,
        );
    }

    async callService(
        domain: string,
        service: string,
        data: Record<string, unknown>,
    ): Promise<unknown> {
        return this.request(`/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`, {
            method: "POST",
            body: data,
        });
    }

    static async loginWithPassword(
        baseUrl: string,
        username: string,
        password: string,
    ): Promise<HomeAssistantTokenSet> {
        const clientId = homeAssistantOAuthClientId(baseUrl);
        const handler = await resolveHomeAssistantAuthHandler(baseUrl);
        const started = await requestJson<HomeAssistantLoginFlow>(`${baseUrl}/auth/login_flow`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                client_id: clientId,
                handler,
                redirect_uri: clientId,
            }),
        });
        if (!started.flow_id) {
            throw HttpErrorFactory.badRequest("无法启动 Home Assistant 登录流程");
        }

        const completed = await requestJson<HomeAssistantLoginFlow>(
            `${baseUrl}/auth/login_flow/${encodeURIComponent(started.flow_id)}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    client_id: clientId,
                    username,
                    password,
                }),
            },
        );
        if (completed.errors && Object.keys(completed.errors).length) {
            throw HttpErrorFactory.unauthorized(
                completed.errors.base === "invalid_auth"
                    ? "Home Assistant 用户名或密码不正确"
                    : "Home Assistant 登录失败",
            );
        }
        if (completed.type === "form" && completed.step_id && completed.step_id !== "init") {
            throw HttpErrorFactory.badRequest(
                "该 HA 账号启用了二次验证，请改用个人资料里的长期访问令牌",
            );
        }
        const code = completed.result;
        if (completed.type !== "create_entry" || typeof code !== "string" || !code) {
            throw HttpErrorFactory.badRequest("Home Assistant 账号密码登录失败");
        }

        return exchangeHomeAssistantToken(baseUrl, {
            grant_type: "authorization_code",
            code,
            client_id: clientId,
        });
    }

    static async refreshPasswordToken(
        baseUrl: string,
        refreshToken: string,
    ): Promise<HomeAssistantTokenSet> {
        return exchangeHomeAssistantToken(
            baseUrl,
            {
                grant_type: "refresh_token",
                refresh_token: refreshToken,
                client_id: homeAssistantOAuthClientId(baseUrl),
            },
            true,
        );
    }

    private request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
        return requestJson<T>(`${this.baseUrl}${path}`, {
            method: init.method || "GET",
            headers: {
                Authorization: `Bearer ${this.accessToken}`,
                "Content-Type": "application/json",
            },
            body: init.body === undefined ? undefined : JSON.stringify(init.body),
        });
    }
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HOME_ASSISTANT_HTTP_TIMEOUT_MS);
    try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        const text = await response.text();
        let payload: unknown = {};
        if (text) {
            try {
                payload = JSON.parse(text);
            } catch {
                payload = { message: text };
            }
        }
        if (!response.ok) {
            const message =
                (isRecord(payload) &&
                    (stringField(payload, "message") ||
                        stringField(payload, "error_description") ||
                        stringField(payload, "error"))) ||
                `Home Assistant 请求失败（${response.status}）`;
            if (response.status === 401 || response.status === 403) {
                throw HttpErrorFactory.unauthorized(message);
            }
            throw HttpErrorFactory.badGateway(message);
        }
        return payload as T;
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
            throw HttpErrorFactory.badGateway("连接 Home Assistant 超时");
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, key: string): string | null {
    const field = value[key];
    return typeof field === "string" && field.trim() ? field : null;
}

type HomeAssistantLoginFlow = {
    flow_id?: string;
    type?: string;
    step_id?: string;
    result?: string;
    errors?: Record<string, string>;
};

type HomeAssistantAuthProvider = {
    type?: string;
    id?: string | null;
};

async function resolveHomeAssistantAuthHandler(baseUrl: string): Promise<[string, string | null]> {
    try {
        const providers = await requestJson<HomeAssistantAuthProvider[]>(`${baseUrl}/auth/providers`);
        const provider = (Array.isArray(providers) ? providers : []).find(
            (item) => item.type === "homeassistant",
        );
        if (provider) return ["homeassistant", provider.id ?? null];
    } catch {
        // Some HA setups hide the provider list; the local username/password handler still works.
    }
    return ["homeassistant", null];
}

async function exchangeHomeAssistantToken(
    baseUrl: string,
    body: Record<string, string>,
    refresh = false,
): Promise<HomeAssistantTokenSet> {
    const payload = await requestJson<{
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        error?: string;
        error_description?: string;
    }>(`${baseUrl}/auth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body).toString(),
    });
    if (!payload.access_token) {
        const message =
            payload.error_description ||
            payload.error ||
            (refresh ? "HA 令牌已失效，请重新登录" : "HA 账号密码登录失败");
        throw refresh
            ? HttpErrorFactory.unauthorized(message)
            : HttpErrorFactory.badRequest(message);
    }
    return {
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token || (refresh ? body.refresh_token || null : null),
        expiresAt: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000) : null,
    };
}
