import AVFoundation
import Foundation
import SwiftUI

@MainActor
final class AppModel: ObservableObject {
    static let defaultAPIBaseURL = APIEndpoint.productionURLString

    @Published private(set) var token: String?
    @Published private(set) var user: UserInfo?
    @Published private(set) var workspaceContext: WorkspaceContext?
    @Published private(set) var triggers: [ProgrammingTriggerItem] = []
    @Published private(set) var projects: [ProgrammingProject] = []
    @Published private(set) var conversations: [ConversationRecord] = []
    @Published private(set) var homeAssistant: HomeAssistantInstance?
    @Published private(set) var devices: [HomeAssistantDevice] = []
    @Published private(set) var cubeCatDevices: [XiaozhiCubeCatDevice] = []
    @Published private(set) var buildingAgents: [BuildingAgentSummary] = []
    @Published private(set) var isBootstrapping = true
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?
    @Published var cameraPresented = false
    @Published var consentPresented = false
    @Published var cameraStatusText = "等待拍照指令"
    @Published var allowSwitchFacing = true
    @Published var cameraBusy = false
    @Published var consentTitle = MobileProtocol.productConsentTitle
    @Published var consentMessage = ""
    @Published var defaultModelId: String {
        didSet { UserDefaults.standard.set(defaultModelId, forKey: "cubemax.default-model-id") }
    }

    let api: APIClient
    let installationId: String
    private(set) var cameraController: CameraSessionController?
    private let keychain = KeychainStore.shared
    private var mobileSocket: MobileWebSocketClient?
    private var currentSession: MobileEnvelope?
    private var currentFacing = "back"
    private var lastCaptureId: String?

    var isAuthenticated: Bool { token != nil && user != nil }
    var selectedWorkspaceId: String? { UserDefaults.standard.string(forKey: "cubemax.workspace-id") }
    var selectedWorkspaceName: String {
        guard let selectedWorkspaceId else { return workspaceContext?.personalWorkspace?.name ?? "个人空间" }
        return workspaceContext?.organizations.first(where: { $0.id == selectedWorkspaceId })?.name ?? "个人空间"
    }

    init() {
        let savedToken = KeychainStore.shared.load()
        token = savedToken
        defaultModelId = UserDefaults.standard.string(forKey: "cubemax.default-model-id") ?? ""
        let savedBaseURL = UserDefaults.standard.string(forKey: "cubemax.api-base-url")
        let normalizedBaseURL = savedBaseURL.flatMap { APIEndpoint.normalizedString(from: $0) } ?? Self.defaultAPIBaseURL
        if savedBaseURL != normalizedBaseURL {
            UserDefaults.standard.set(normalizedBaseURL, forKey: "cubemax.api-base-url")
        }
        let installationId = KeychainStore.shared.installationId()
        self.installationId = installationId
        api = APIClient(baseURLString: normalizedBaseURL, token: savedToken, installationId: installationId)
        Task { [weak self] in
            guard let self else { return }
            await self.restoreSession()
        }
    }

    func login(username: String, password: String, baseURL: String) async throws {
        errorMessage = nil
        let normalizedBaseURL = try await api.updateBaseURL(baseURL)
        UserDefaults.standard.set(normalizedBaseURL, forKey: "cubemax.api-base-url")
        let response = try await api.login(username: username, password: password)
        try keychain.save(token: response.token)
        token = response.token
        await api.setToken(response.token)
        user = response.user
        await loadWorkspace()
        await loadDashboard()
        await ensureMobileSocket()
    }

    func restoreSession() async {
        defer { isBootstrapping = false }
        guard token != nil else { return }
        do {
            await api.setToken(token)
            user = try await api.userInfo()
            await loadWorkspace()
            await loadDashboard()
            await ensureMobileSocket()
        } catch {
            await clearSession()
            errorMessage = localized(error)
        }
    }

    func logout() async {
        mobileSocket?.close()
        mobileSocket = nil
        cameraController?.stop()
        cameraPresented = false
        consentPresented = false
        await api.logout()
        await clearSession()
    }

    func clearError() { errorMessage = nil }

    func selectWorkspace(_ id: String) async {
        let organizationId = id == "personal" ? nil : id
        if let organizationId { UserDefaults.standard.set(organizationId, forKey: "cubemax.workspace-id") }
        else { UserDefaults.standard.removeObject(forKey: "cubemax.workspace-id") }
        await api.setOrganizationId(organizationId)
        cubeCatDevices = []
        buildingAgents = []
        accounts = []
        devices = []
        await loadDashboard()
        await loadCubeCatDevices()
        await loadSmartHome()
    }

    func loadWorkspace() async {
        do {
            workspaceContext = try await api.workspaceContext()
            await api.setOrganizationId(selectedWorkspaceId)
        } catch { errorMessage = localized(error) }
    }

    func loadDashboard() async {
        isLoading = true
        defer { isLoading = false }
        await loadTriggers()
        await loadConversations()
    }

    func loadTriggers() async {
        do { triggers = try await api.triggers().items }
        catch { errorMessage = localized(error) }
    }

    func loadProjects() async {
        do { projects = try await api.projects().items.filter(\.isPublished) }
        catch { errorMessage = localized(error) }
    }

    func loadCubeCatDevices() async {
        do {
            async let loadedDevices: [XiaozhiCubeCatDevice] = api.xiaozhiCubeCatDevices()
            async let loadedAgents: Paginated<BuildingAgentSummary> = api.myBuildingAgents()
            let (devices, agents) = try await (loadedDevices, loadedAgents)
            cubeCatDevices = devices
            buildingAgents = agents.items
        }
        catch { errorMessage = localized(error) }
    }

    func updateCubeCatDevice(
        _ device: XiaozhiCubeCatDevice,
        alias: String,
        settings: CubeCatDeviceSettings,
        autoUpdate: Bool
    ) async throws {
        if alias.trimmingCharacters(in: .whitespacesAndNewlines) != device.alias {
            try await api.updateXiaozhiDeviceAlias(
                agentId: device.agentId,
                deviceId: device.id,
                macAddress: device.macAddress,
                alias: alias.trimmingCharacters(in: .whitespacesAndNewlines)
            )
        }
        if settings.volume != device.settings.volume ||
            settings.brightness != device.settings.brightness ||
            settings.doNotDisturb != device.settings.doNotDisturb {
            try await api.updateXiaozhiDeviceSettings(
                agentId: device.agentId,
                deviceId: device.id,
                settings: settings
            )
        }
        if autoUpdate != device.autoUpdate {
            try await api.updateXiaozhiDeviceAutoUpdate(
                agentId: device.agentId,
                deviceId: device.id,
                autoUpdate: autoUpdate,
                macAddress: device.macAddress
            )
        }
        await loadCubeCatDevices()
    }

    func switchCubeCatAgent(_ device: XiaozhiCubeCatDevice, buildingAgentId: String?) async throws {
        try await api.linkBuildingAgent(
            xiaozhiAgentId: device.agentId,
            buildingAgentId: buildingAgentId
        )
        await loadCubeCatDevices()
    }

    func loadLuaRuns(for device: CubeCatDevice) async throws -> [LuaDeviceRun] {
        try await api.luaRuns(deviceId: device.deviceId)
    }

    func loadLuaRunLogs(deviceId: String, runId: String) async throws -> [LuaDeviceRunLog] {
        try await api.luaRunLogs(deviceId: deviceId, runId: runId)
    }

    func stopLuaRun(deviceId: String, runId: String) async throws {
        _ = try await api.stopLuaRun(deviceId: deviceId, runId: runId)
    }

    func createTrigger(name: String, description: String?, projectId: String, pinned: Bool) async throws {
        _ = try await api.createTrigger(name: name, description: description, projectId: projectId, pinned: pinned)
        await loadTriggers()
    }

    func executeTrigger(_ trigger: ProgrammingTriggerItem, inputs: [String: JSONValue]) async throws -> String {
        await ensureMobileSocket()
        let response = try await api.executeTrigger(id: trigger.id, inputs: inputs)
        return response.taskID
    }

    func ensureMobileSocket() async {
        if mobileSocket == nil {
            let client = MobileWebSocketClient(api: api, installationId: installationId)
            client.onEnvelope = { [weak self] envelope in
                self?.handleMobileEnvelope(envelope)
            }
            client.onUnauthorized = { [weak self] in
                Task { await self?.logout() }
            }
            client.onDisconnect = { [weak self] in
                Task { await self?.handleSocketDrop() }
            }
            mobileSocket = client
        }
        await mobileSocket?.connect()
    }

    func approveCameraConsent() {
        consentPresented = false
        Task { await startPreviewAfterConsent() }
    }

    func denyCameraConsent() {
        consentPresented = false
        guard let session = currentSession else { return }
        Task {
            await mobileSocket?.send(.make(
                type: "camera.session.rejected",
                data: [
                    "session_id": .string(session.sessionId ?? ""),
                    "reason": .string("product_consent_denied"),
                ],
                replyTo: session.id
            ))
        }
        currentSession = nil
    }

    func cancelCameraSession() {
        guard let session = currentSession else {
            cameraPresented = false
            return
        }
        Task {
            await mobileSocket?.send(.make(
                type: "camera.session.cancel",
                data: [
                    "session_id": .string(session.sessionId ?? ""),
                    "reason": .string("user_closed"),
                ]
            ))
        }
        dismissCamera()
    }

    func switchCameraFacing() {
        guard let cameraController, allowSwitchFacing, !cameraBusy else { return }
        Task {
            do {
                try await cameraController.switchFacing()
                currentFacing = cameraController.facing == .front ? "front" : "back"
                await mobileSocket?.send(.make(type: "camera.session.state", data: [
                    "session_id": .string(currentSession?.sessionId ?? ""),
                    "facing": .string(currentFacing),
                    "preview": .bool(true),
                ]))
            } catch {
                errorMessage = localized(error)
            }
        }
    }

    func handleScenePhase(_ phase: ScenePhase) {
        if phase == .active {
            Task { await ensureMobileSocket() }
        } else if phase == .background {
            Task {
                await mobileSocket?.sendStatus(
                    appState: "background",
                    sessionId: currentSession?.sessionId,
                    previewing: cameraPresented,
                    facing: currentFacing
                )
            }
            cameraController?.stop()
        }
    }

    func loadConversations() async {
        do { conversations = try await api.conversations().items }
        catch { errorMessage = localized(error) }
    }

    func createConversation() async throws -> ConversationRecord {
        let conversation = try await api.createConversation(title: nil)
        conversations.insert(conversation, at: 0)
        return conversation
    }

    func loadMessages(for conversationId: String) async throws -> [ChatMessage] {
        try await api.messages(conversationId: conversationId).items
    }

    func sendMessage(_ text: String, conversation: ConversationRecord, modelId: String) async throws -> String {
        let payload = ChatSendRequest(
            modelId: modelId,
            conversationId: conversation.id,
            messages: [ChatInputMessage(id: UUID().uuidString, role: "user", parts: [ChatInputPart(type: "text", text: text)])],
            title: conversation.title
        )
        let result = try await api.sendChat(payload)
        await loadConversations()
        return result
    }

    func loadSmartHome() async {
        do {
            async let loadedInstance = api.homeAssistantInstance()
            async let loadedDevices = api.homeAssistantDevices()
            homeAssistant = try await loadedInstance
            devices = try await loadedDevices
        } catch { errorMessage = localized(error) }
    }

    func syncHomeAssistant() async throws {
        homeAssistant = try await api.syncHomeAssistant()
        await loadSmartHome()
    }

    func refreshDevice(_ device: HomeAssistantDevice) async throws {
        replaceDevice(try await api.refreshHomeAssistantDevice(device.id))
    }

    func controlDevice(_ device: HomeAssistantDevice, command: HomeAssistantLightCommand) async throws {
        replaceDevice(try await api.controlHomeAssistantDevice(device.id, command: command))
    }

    private func replaceDevice(_ device: HomeAssistantDevice) {
        if let index = devices.firstIndex(where: { $0.id == device.id }) { devices[index] = device }
        else { devices.append(device) }
    }

    private func clearSession() async {
        keychain.delete()
        token = nil
        user = nil
        workspaceContext = nil
        triggers = []
        conversations = []
        homeAssistant = nil
        devices = []
        cubeCatDevices = []
        buildingAgents = []
    }

    private func localized(_ error: Error) -> String {
        if let error = error as? LocalizedError, let description = error.errorDescription { return description }
        return error.localizedDescription
    }

    private func handleMobileEnvelope(_ envelope: MobileEnvelope) {
        switch envelope.type {
        case "camera.session.start":
            presentConsent(envelope)
        case "camera.capture":
            Task { await handleCaptureCommand(envelope) }
        case "camera.session.close":
            dismissCamera()
        case "error":
            if envelope.data["code"]?.stringValue == "CAPTURE_SESSION_MISMATCH" {
                cameraStatusText = "失败"
            }
        default:
            if envelope.type.hasPrefix("camera.stream.") || envelope.type.hasPrefix("camera.webrtc.") {
                Task {
                    await mobileSocket?.send(.make(
                        type: "error",
                        data: [
                            "code": .string("UNSUPPORTED_CAPABILITY"),
                            "message": .string(envelope.type),
                            "retryable": .bool(false),
                        ],
                        replyTo: envelope.id
                    ))
                }
            } else if envelope.type != "hello.welcome" {
                Task {
                    await mobileSocket?.send(.make(
                        type: "error",
                        data: [
                            "code": .string("UNSUPPORTED_MESSAGE"),
                            "message": .string(envelope.type),
                            "retryable": .bool(false),
                        ],
                        replyTo: envelope.id
                    ))
                }
            }
        }
    }

    private func presentConsent(_ envelope: MobileEnvelope) {
        currentSession = envelope
        let title = envelope.title.map { String($0.prefix(40)) } ?? "工作流"
        consentTitle = envelope.consentPrompt == MobileProtocol.productConsentTitle
            ? MobileProtocol.productConsentTitle
            : MobileProtocol.productConsentTitle
        consentMessage = "工作流「\(title)」需要拍摄一张照片并发送到 CubeMax 服务器，供后续节点使用。你可以随时拒绝。"
        consentPresented = true
    }

    private func startPreviewAfterConsent() async {
        guard let session = currentSession else { return }
        do {
            let granted = await AVCaptureDevice.requestAccess(for: .video)
            guard granted else {
                await mobileSocket?.send(.make(
                    type: "camera.session.rejected",
                    data: [
                        "session_id": .string(session.sessionId ?? ""),
                        "reason": .string("system_permission_denied"),
                    ],
                    replyTo: session.id
                ))
                errorMessage = "请在系统设置中允许 CubeMax 使用摄像头"
                return
            }
            let controller = CameraSessionController()
            cameraController = controller
            allowSwitchFacing = session.allowSwitchFacing
            currentFacing = session.facingDefault
            try await controller.start(facing: session.facingDefault == "front" ? .front : .back)
            cameraStatusText = "等待拍照指令"
            cameraPresented = true
            await mobileSocket?.send(.make(
                type: "camera.session.ready",
                data: [
                    "session_id": .string(session.sessionId ?? ""),
                    "facing": .string(currentFacing),
                    "preview_width": .number(1920),
                    "preview_height": .number(1080),
                    "system_permission": .string("authorized"),
                    "product_consent": .bool(true),
                ],
                replyTo: session.id
            ))
        } catch {
            await mobileSocket?.send(.make(
                type: "camera.session.rejected",
                data: [
                    "session_id": .string(session.sessionId ?? ""),
                    "reason": .string("camera_unavailable"),
                ],
                replyTo: session.id
            ))
            errorMessage = localized(error)
        }
    }

    private func handleCaptureCommand(_ envelope: MobileEnvelope) async {
        guard let session = currentSession,
              envelope.sessionId == session.sessionId,
              let captureId = envelope.captureId,
              let controller = cameraController else {
            await mobileSocket?.send(.make(
                type: "error",
                data: [
                    "code": .string("CAPTURE_SESSION_MISMATCH"),
                    "message": .string("capture session mismatch"),
                    "retryable": .bool(false),
                ],
                replyTo: envelope.id
            ))
            return
        }
        if lastCaptureId == captureId {
            return
        }
        cameraBusy = true
        cameraStatusText = "正在拍照"
        await mobileSocket?.send(.make(
            type: "camera.capture.accepted",
            data: [
                "session_id": .string(session.sessionId ?? ""),
                "capture_id": .string(captureId),
            ],
            replyTo: envelope.id
        ))
        do {
            let result = try await controller.captureJPEG(
                quality: envelope.jpegQuality,
                maxEdge: envelope.maxEdgePx,
                maxBytes: envelope.maxBytes
            )
            cameraStatusText = "正在上传"
            let uploaded = try await CameraCaptureUploader.upload(
                api: api,
                jpeg: result.data,
                sessionId: session.sessionId ?? "",
                captureId: captureId,
                facing: currentFacing,
                width: result.width,
                height: result.height
            )
            lastCaptureId = captureId
            cameraStatusText = "已完成"
            await mobileSocket?.send(.make(
                type: "camera.capture.result",
                data: [
                    "session_id": .string(session.sessionId ?? ""),
                    "capture_id": .string(captureId),
                    "file_id": .string(uploaded.fileId ?? ""),
                    "url": .string(uploaded.url ?? ""),
                    "sha256": .string(uploaded.sha256 ?? CameraCaptureUploader.sha256Hex(result.data)),
                    "size": .number(Double(uploaded.size ?? result.data.count)),
                    "width": .number(Double(uploaded.width ?? result.width)),
                    "height": .number(Double(uploaded.height ?? result.height)),
                    "mime_type": .string("image/jpeg"),
                    "facing": .string(currentFacing),
                ],
                replyTo: envelope.id
            ))
        } catch {
            cameraStatusText = "失败"
            errorMessage = localized(error)
            await mobileSocket?.send(.make(
                type: "error",
                data: [
                    "code": .string("CAPTURE_FAILED"),
                    "message": .string(error.localizedDescription),
                    "retryable": .bool(true),
                ],
                replyTo: envelope.id
            ))
        }
        cameraBusy = false
    }

    private func handleSocketDrop() async {
        guard cameraPresented else { return }
        try? await Task.sleep(nanoseconds: 2_000_000_000)
        if cameraPresented && mobileSocket?.onEnvelope != nil {
            dismissCamera()
            errorMessage = "与服务器的实时连接已断开"
        }
    }

    private func dismissCamera() {
        cameraController?.stop()
        cameraController = nil
        cameraPresented = false
        consentPresented = false
        cameraBusy = false
        currentSession = nil
        lastCaptureId = nil
        cameraStatusText = "等待拍照指令"
    }
}
