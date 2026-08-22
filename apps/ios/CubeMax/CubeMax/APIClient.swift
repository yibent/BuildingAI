import Foundation

enum APIEndpoint {
    static let productionURLString = "https://max.sh.creativone.cn/api"
    static let developmentURLString = "http://127.0.0.1:4090/api"

    static var productionURL: URL {
        URL(string: productionURLString)!
    }

    /// Normalizes user-entered API URLs and upgrades the deployed endpoint to HTTPS.
    /// The upgrade is intentionally limited to our known host so arbitrary local
    /// development URLs are not silently changed.
    static func normalizedURL(from value: String) -> URL? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              var components = URLComponents(string: trimmed),
              let rawScheme = components.scheme,
              let host = components.host,
              !host.isEmpty else {
            return nil
        }

        let scheme = rawScheme.lowercased()
        guard scheme == "http" || scheme == "https" else { return nil }
        components.scheme = scheme

        if host.caseInsensitiveCompare("max.sh.creativone.cn") == .orderedSame {
            components.scheme = "https"
        }

        while components.path.count > 1 && components.path.hasSuffix("/") {
            components.path.removeLast()
        }
        return components.url
    }

    static func normalizedString(from value: String) -> String? {
        normalizedURL(from: value)?.absoluteString
    }
}

enum APIClientError: LocalizedError {
    case invalidBaseURL
    case insecureConnection
    case invalidResponse
    case network(Error)
    case server(message: String, code: Int?)
    case decoding(Error)

    var errorDescription: String? {
        switch self {
        case .invalidBaseURL: return "API 地址无效，请检查服务器地址"
        case .insecureConnection:
            return "iOS 阻止了不安全的 HTTP 连接，请将服务器地址改为 https://max.sh.creativone.cn/api"
        case .invalidResponse: return "服务器返回了无效响应"
        case .network(let error): return "网络请求失败：\(error.localizedDescription)"
        case .server(let message, _): return message
        case .decoding(let error): return "数据解析失败：\(error.localizedDescription)"
        }
    }
}

struct ChatSendRequest: Encodable {
    let modelId: String
    let conversationId: String?
    let messages: [ChatInputMessage]
    let title: String?
}

struct ChatInputMessage: Encodable {
    let id: String
    let role: String
    let parts: [ChatInputPart]
}

struct ChatInputPart: Encodable {
    let type: String
    let text: String
}

actor APIClient {
    private let session: URLSession
    private(set) var baseURL: URL
    private(set) var token: String?
    private(set) var organizationId: String?
    private(set) var installationId: String?

    init(baseURLString: String, token: String? = nil, installationId: String? = nil) {
        self.session = URLSession(configuration: .default)
        self.baseURL = APIEndpoint.normalizedURL(from: baseURLString) ?? APIEndpoint.productionURL
        self.token = token
        self.installationId = installationId
    }

    @discardableResult
    func updateBaseURL(_ value: String) throws -> String {
        guard let url = APIEndpoint.normalizedURL(from: value) else {
            throw APIClientError.invalidBaseURL
        }
        baseURL = url
        return url.absoluteString
    }

    func setToken(_ value: String?) { token = value }
    func setOrganizationId(_ value: String?) { organizationId = value }
    func setInstallationId(_ value: String?) { installationId = value }

    func mobileWebSocketURL() -> URL? {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else { return nil }
        let scheme = (components.scheme ?? "https").lowercased()
        components.scheme = scheme == "https" ? "wss" : "ws"
        let path = components.path.hasSuffix("/") ? String(components.path.dropLast()) : components.path
        components.path = "\(path)/mobile-ws/v1"
        components.query = nil
        return components.url
    }

    func uploadCameraCapture(
        jpeg: Data,
        sessionId: String,
        captureId: String,
        sha256: String,
        facing: String,
        width: Int,
        height: Int
    ) async throws -> CameraCaptureUploadResponse {
        let url = baseURL.appendingPathComponent("mobile/camera/captures")
        let boundary = "Boundary-\(UUID().uuidString)"
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        applyAuthHeaders(&request)
        var body = Data()
        func appendField(_ name: String, _ value: String) {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n".data(using: .utf8)!)
            body.append("\(value)\r\n".data(using: .utf8)!)
        }
        appendField("session_id", sessionId)
        appendField("capture_id", captureId)
        appendField("sha256", sha256)
        appendField("facing", facing)
        appendField("width", String(width))
        appendField("height", String(height))
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"camera-capture-\(captureId).jpg\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: image/jpeg\r\n\r\n".data(using: .utf8)!)
        body.append(jpeg)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        request.httpBody = body
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw transportError(error)
        }
        try validate(response, data: data)
        if let envelope = try? JSONDecoder().decode(APIEnvelope<CameraCaptureUploadResponse>.self, from: data) {
            return envelope.data
        }
        return try JSONDecoder().decode(CameraCaptureUploadResponse.self, from: data)
    }

    func login(username: String, password: String) async throws -> LoginResponse {
        try await request("/auth/login", method: "POST", body: LoginRequest(username: username, password: password, terminal: 4))
    }

    func userInfo() async throws -> UserInfo { try await request("/user/info") }
    func workspaceContext() async throws -> WorkspaceContext { try await request("/organizations/context") }

    func triggers() async throws -> Paginated<ProgrammingTriggerItem> {
        try await request("/programming-triggers", query: ["page": "1", "pageSize": "100"])
    }

    func createTrigger(name: String, description: String?, projectId: String, pinned: Bool) async throws -> ProgrammingTriggerItem {
        return try await request("/programming-triggers", method: "POST", body: CreateTriggerRequest(name: name, description: description, projectId: projectId, triggerType: "form", isPinned: pinned))
    }

    func executeTrigger(id: String, inputs: [String: JSONValue]) async throws -> ExecuteTriggerResponse {
        try await request("/programming-triggers/\(id)/execute", method: "POST", body: ExecuteTriggerRequest(inputs: inputs))
    }

    func projects() async throws -> Paginated<ProgrammingProject> {
        try await request("/programming-projects", query: ["page": "1", "pageSize": "100"])
    }

    /// xiaozhi-backed CubeCat assets. Keep this separate from `/devices`,
    /// which is reserved for the Lua/ESP runtime.
    func xiaozhiCubeCatDevices() async throws -> [XiaozhiCubeCatDevice] {
        try await request("/organizations/xiaozhi/devices")
    }

    func myBuildingAgents() async throws -> Paginated<BuildingAgentSummary> {
        try await request("/ai-agents/my-created", query: ["page": "1", "pageSize": "100"])
    }

    func linkBuildingAgent(xiaozhiAgentId: String, buildingAgentId: String?) async throws {
        try await requestVoid(
            "/organizations/xiaozhi/agents/\(xiaozhiAgentId)/building-agent",
            method: "PATCH",
            body: LinkBuildingAgentRequest(agentId: buildingAgentId)
        )
    }

    func updateXiaozhiDeviceAlias(
        agentId: String,
        deviceId: Int,
        macAddress: String,
        alias: String
    ) async throws {
        try await requestVoid(
            "/organizations/xiaozhi/agents/\(agentId)/devices/\(deviceId)/alias",
            method: "PATCH",
            body: XiaozhiDeviceAliasRequest(macAddress: macAddress, alias: alias)
        )
    }

    func updateXiaozhiDeviceSettings(
        agentId: String,
        deviceId: Int,
        settings: CubeCatDeviceSettings
    ) async throws {
        try await requestVoid(
            "/organizations/xiaozhi/agents/\(agentId)/devices/\(deviceId)/settings",
            method: "PATCH",
            body: settings
        )
    }

    func updateXiaozhiDeviceAutoUpdate(
        agentId: String,
        deviceId: Int,
        autoUpdate: Bool,
        macAddress: String
    ) async throws {
        try await requestVoid(
            "/organizations/xiaozhi/agents/\(agentId)/devices/\(deviceId)/auto-update",
            method: "PATCH",
            body: XiaozhiDeviceAutoUpdateRequest(macAddress: macAddress, autoUpdate: autoUpdate)
        )
    }
    func luaRuns(deviceId: String) async throws -> [LuaDeviceRun] {
        try await request("/devices/\(deviceId)/lua-runs")
    }
    func luaRunLogs(deviceId: String, runId: String) async throws -> [LuaDeviceRunLog] {
        try await request("/devices/\(deviceId)/lua-runs/\(runId)/logs", query: ["after": "0"])
    }
    func stopLuaRun(deviceId: String, runId: String) async throws -> LuaDeviceRun {
        try await request("/devices/\(deviceId)/lua-runs/\(runId)/stop", method: "POST")
    }

    func conversations() async throws -> Paginated<ConversationRecord> {
        try await request("/ai-conversations", query: ["page": "1", "pageSize": "50"])
    }

    func createConversation(title: String?) async throws -> ConversationRecord {
        return try await request("/ai-conversations", method: "POST", body: CreateConversationRequest(title: title))
    }

    func messages(conversationId: String) async throws -> Paginated<ChatMessage> {
        try await request("/ai-conversations/\(conversationId)/messages", query: ["page": "1", "pageSize": "100"])
    }

    /// Consumes the AI SDK data stream and returns the accumulated assistant text.
    /// The endpoint remains stream based so this can be changed to incremental UI updates later.
    func sendChat(_ payload: ChatSendRequest) async throws -> String {
        var request = try makeRequest("/ai-chat", method: "POST", body: payload)
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        let (bytes, response): (URLSession.AsyncBytes, URLResponse)
        do {
            (bytes, response) = try await session.bytes(for: request)
        } catch {
            throw transportError(error)
        }
        try validate(response)

        var result = ""
        for try await line in bytes.lines {
            guard line.hasPrefix("data:") else { continue }
            let value = String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
            if value == "[DONE]" { break }
            result += streamText(from: value)
        }
        return result
    }

    func homeAssistantInstance() async throws -> HomeAssistantInstance? {
        try await request("/smart-home/ha/instance")
    }
    func homeAssistantDevices() async throws -> [HomeAssistantDevice] {
        try await request("/smart-home/ha/devices")
    }
    func syncHomeAssistant() async throws -> HomeAssistantInstance {
        try await request("/smart-home/ha/instance/sync", method: "POST")
    }
    func refreshHomeAssistantDevice(_ id: String) async throws -> HomeAssistantDevice {
        try await request("/smart-home/ha/devices/\(id)/refresh", method: "POST")
    }
    func controlHomeAssistantDevice(_ id: String, command: HomeAssistantLightCommand) async throws -> HomeAssistantDevice {
        try await request("/smart-home/ha/devices/\(id)/command", method: "POST", body: command)
    }

    func logout() async {
        try? await requestVoid("/auth/logout", method: "POST")
        token = nil
    }

    private func makeRequest<Body: Encodable>(_ path: String, method: String = "GET", body: Body? = nil, query: [String: String] = [:]) throws -> URLRequest {
        guard var components = URLComponents(url: baseURL.appendingPathComponent(path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))), resolvingAgainstBaseURL: false) else {
            throw APIClientError.invalidBaseURL
        }
        if !query.isEmpty { components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) } }
        guard let url = components.url else { throw APIClientError.invalidBaseURL }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        applyAuthHeaders(&request)
        if let body { request.httpBody = try JSONEncoder().encode(body) }
        return request
    }

    private func request<T: Decodable & Sendable, Body: Encodable>(_ path: String, method: String = "GET", body: Body? = nil, query: [String: String] = [:]) async throws -> T {
        let request = try makeRequest(path, method: method, body: body, query: query)
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw transportError(error)
        }
        try validate(response, data: data)
        do {
            if let envelope = try? JSONDecoder().decode(APIEnvelope<T>.self, from: data) { return envelope.data }
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIClientError.decoding(error)
        }
    }

    private func request<T: Decodable & Sendable>(_ path: String, method: String = "GET", query: [String: String] = [:]) async throws -> T {
        try await request(path, method: method, body: Optional<EmptyRequest>.none, query: query)
    }

    private func requestVoid(_ path: String, method: String = "GET") async throws {
        let request = try makeRequest(path, method: method, body: Optional<EmptyRequest>.none)
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw transportError(error)
        }
        try validate(response, data: data)
    }

    private func requestVoid<Body: Encodable>(_ path: String, method: String, body: Body) async throws {
        let request = try makeRequest(path, method: method, body: body)
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw transportError(error)
        }
        try validate(response, data: data)
    }

    private func applyAuthHeaders(_ request: inout URLRequest) {
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let organizationId { request.setValue(organizationId, forHTTPHeaderField: "x-organization-id") }
        if let installationId { request.setValue(installationId, forHTTPHeaderField: "X-Installation-Id") }
    }

    private func transportError(_ error: Error) -> APIClientError {
        if let urlError = error as? URLError,
           urlError.code == .appTransportSecurityRequiresSecureConnection {
            return .insecureConnection
        }
        return .network(error)
    }

    private func validate(_ response: URLResponse, data: Data? = nil) throws {
        guard let response = response as? HTTPURLResponse else { throw APIClientError.invalidResponse }
        guard (200..<300).contains(response.statusCode) else {
            var message = HTTPURLResponse.localizedString(forStatusCode: response.statusCode)
            var code: Int?
            if let data, let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                message = object["message"] as? String ?? message
                code = object["code"] as? Int
            }
            throw APIClientError.server(message: message, code: code)
        }
    }

    private func streamText(from value: String) -> String {
        if let data = value.data(using: .utf8),
           let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if let delta = object["delta"] as? String { return delta }
            if let text = object["text"] as? String { return text }
            if let nested = object["data"] as? [String: Any] {
                return (nested["delta"] as? String) ?? (nested["text"] as? String) ?? ""
            }
        }
        if let data = value.data(using: .utf8), let string = try? JSONDecoder().decode(String.self, from: data) { return string }
        return value.hasPrefix("0:") ? String(value.dropFirst(2)).trimmingCharacters(in: CharacterSet(charactersIn: "\"")) : ""
    }
}

private struct EmptyRequest: Encodable {}

private struct XiaozhiDeviceAliasRequest: Encodable {
    let macAddress: String
    let alias: String
}

private struct XiaozhiDeviceAutoUpdateRequest: Encodable {
    let macAddress: String
    let autoUpdate: Bool
}

private struct LinkBuildingAgentRequest: Encodable {
    let agentId: String?
}

private struct LoginRequest: Encodable {
    let username: String
    let password: String
    let terminal: Int
}

private struct CreateTriggerRequest: Encodable {
    let name: String
    let description: String?
    let projectId: String
    let triggerType: String
    let isPinned: Bool
}

private struct ExecuteTriggerRequest: Encodable {
    let inputs: [String: JSONValue]
}

private struct CreateConversationRequest: Encodable {
    let title: String?
}


