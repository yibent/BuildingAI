import Foundation

struct APIEnvelope<Value: Decodable & Sendable>: Decodable, Sendable {
    let code: Int
    let message: String
    let data: Value
}

struct EmptyResponse: Decodable, Sendable {}

struct CameraCaptureUploadResponse: Decodable, Sendable {
    let captureId: String
    let sessionId: String
    let fileId: String?
    let url: String?
    let sha256: String?
    let size: Int?
    let width: Int?
    let height: Int?
    let facing: String?

    enum CodingKeys: String, CodingKey {
        case captureId = "capture_id"
        case sessionId = "session_id"
        case fileId = "file_id"
        case url, sha256, size, width, height, facing
    }
}

struct LoginResponse: Decodable, Sendable {
    let token: String
    let expiresAt: String?
    let user: UserInfo
}

struct UserInfo: Codable, Identifiable, Sendable {
    let id: String
    let username: String
    let nickname: String?
    let realName: String?
    let avatar: String?
    let hasPersonalWorkspace: Bool?

    var displayName: String { nickname?.isEmpty == false ? nickname! : username }

    enum CodingKeys: String, CodingKey {
        case id, username, nickname, realName, avatar, hasPersonalWorkspace
    }
}

struct WorkspaceContext: Codable, Sendable {
    let personalWorkspace: PersonalWorkspace?
    let organizations: [OrganizationWorkspace]

    var choices: [WorkspaceChoice] {
        var result = personalWorkspace.map { [WorkspaceChoice.personal($0)] } ?? []
        result.append(contentsOf: organizations.map(WorkspaceChoice.organization))
        return result
    }
}

struct PersonalWorkspace: Codable, Sendable {
    let id: String?
    let type: String
    let name: String
    let roles: [String]
    let permissions: [String]
}

struct OrganizationWorkspace: Codable, Identifiable, Sendable {
    let id: String
    let type: String
    let name: String
    let code: String
    let roles: [String]
    let permissions: [String]
    let memberType: String
    let canLeave: Bool
}

enum WorkspaceChoice: Identifiable, Hashable, Sendable {
    case personal(PersonalWorkspace)
    case organization(OrganizationWorkspace)

    var id: String {
        switch self {
        case .personal: return "personal"
        case .organization(let workspace): return workspace.id
        }
    }

    var name: String {
        switch self {
        case .personal(let workspace): return workspace.name
        case .organization(let workspace): return workspace.name
        }
    }

    var organizationId: String? {
        if case .organization(let workspace) = self { return workspace.id }
        return nil
    }

    static func == (lhs: WorkspaceChoice, rhs: WorkspaceChoice) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

final class JSONSchema: Codable, @unchecked Sendable {
    let type: String?
    let title: String?
    let description: String?
    let defaultValue: JSONValue?
    let enumValues: [JSONValue]?
    let properties: [String: JSONSchema]?
    let required: [String]?
    let items: JSONSchema?
    let format: String?

    enum CodingKeys: String, CodingKey {
        case type, title, description
        case defaultValue = "default"
        case enumValues = "enum"
        case properties, required, items, format
    }

    init(type: String?, title: String?, description: String?, defaultValue: JSONValue?, enumValues: [JSONValue]?, properties: [String: JSONSchema]?, required: [String]?, items: JSONSchema?, format: String?) {
        self.type = type
        self.title = title
        self.description = description
        self.defaultValue = defaultValue
        self.enumValues = enumValues
        self.properties = properties
        self.required = required
        self.items = items
        self.format = format
    }

    var isObject: Bool { type == "object" || type == "map" || properties != nil }
    var isBoolean: Bool { type == "boolean" }
    var isNumber: Bool { type == "number" || type == "integer" }
}

struct ProgrammingTriggerProject: Codable, Sendable {
    let id: String
    let name: String
    let isPublished: Bool
    let runtimeTarget: String
    let mainWorkflowId: String
}

struct ProgrammingTriggerItem: Codable, Identifiable, Sendable {
    let id: String
    let name: String
    let description: String?
    let projectId: String
    let triggerType: String
    let inputSchema: JSONSchema
    let isEnabled: Bool
    let isPinned: Bool
    let homeOrder: Int
    let createdAt: String
    let updatedAt: String
    let project: ProgrammingTriggerProject

    var fieldCount: Int { inputSchema.properties?.count ?? 0 }
}

struct ProgrammingProject: Codable, Identifiable, Sendable {
    let id: String
    let name: String
    let description: String?
    let isPublished: Bool
    let mainWorkflowId: String
    let runtimeTarget: String
}

struct BuildingAgentSummary: Codable, Identifiable, Sendable {
    let id: String
    let name: String
    let avatar: String?
    let description: String?
}

struct CubeCatDevice: Codable, Identifiable, Sendable {
    let id: String
    let deviceId: String
    let displayName: String
    let online: Bool
    let firmwareVersion: String?
    let bootId: String?
    let capabilities: [String]
    let limits: CubeCatDeviceLimits?
    let runtime: CubeCatDeviceRuntime?
    let lastSeenAt: String?
    let createdAt: String?
    let updatedAt: String?
}

enum CubeCatDeviceType: String, Codable, Sendable {
    case unknown
    case lite = "CubeCat-Lite"
    case s = "CubeCat-S"

    var displayName: String {
        switch self {
        case .unknown: return "型号待指定"
        case .lite: return "CubeCat-Lite"
        case .s: return "CubeCat-S"
        }
    }
}

struct CubeCatDeviceSettings: Codable, Sendable {
    var volume: Int
    var brightness: Int
    var doNotDisturb: Bool
}

/// A xiaozhi.me-backed CubeCat asset. This is intentionally separate from
/// `CubeCatDevice`, which represents the Lua/ESP gateway introduced earlier.
struct XiaozhiCubeCatDevice: Codable, Identifiable, Sendable {
    let id: Int
    let agentId: String
    let macAddress: String
    let alias: String
    let boardName: String
    let appVersion: String
    let serialNumber: String
    let autoUpdate: Bool
    let online: Bool
    let authorized: Bool
    let lastConnectedAt: String?
    let deviceType: CubeCatDeviceType
    let deviceTypeLabel: String
    let agentName: String
    let upstreamAgentId: String
    let linkedAgentId: String?
    let linkedAgentName: String?
    let model: String?
    let voice: String?
    let agentDeviceCount: Int
    var settings: CubeCatDeviceSettings
    let canManage: Bool
    let canSetDeviceType: Bool

    var displayName: String {
        alias.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? deviceTypeLabel : alias
    }

    var stableID: String { "\(agentId):\(id)" }

    var assetImageName: String {
        switch deviceType {
        case .s: return "CubeCat-S"
        case .lite, .unknown: return "CubeCat-Lite"
        }
    }
}

struct CubeCatDeviceLimits: Codable, Sendable {
    let maxScriptBytes: Int
    let maxParamsBytes: Int
    let maxChunkBytes: Int
    let maxMessageBytes: Int
    let maxLogBytes: Int
}

struct CubeCatDeviceRuntime: Codable, Sendable {
    let executionModel: String
    let apiVersion: String
    let transferStorage: String
    let maxRunTimeoutMs: Int
}

enum LuaDeviceRunStatus: String, Codable, Sendable {
    case queued, preparing, transferring, running, stopping, waitingForDevice = "waiting_for_device"
    case succeeded, failed, stopped, timedOut = "timed_out"
}

struct LuaDeviceRun: Codable, Identifiable, Sendable {
    let id: String
    let deviceId: String
    let moduleId: String?
    let projectId: String?
    let name: String
    let sourceSha256: String
    let params: [String: JSONValue]
    let requiredCapabilities: [String]
    let status: LuaDeviceRunStatus
    let timeoutMs: Int
    let nextChunkIndex: Int
    let result: JSONValue?
    let error: LuaDeviceRunError?
    let startedAt: String?
    let finishedAt: String?
    let createdAt: String
    let updatedAt: String
}

struct LuaDeviceRunError: Codable, Sendable {
    let code: String
    let message: String
    let line: Int?
}

struct LuaDeviceRunLog: Codable, Identifiable, Sendable {
    let id: String
    let runId: String
    let sequence: Int
    let level: String
    let text: String
    let createdAt: String
}

struct Paginated<Value: Decodable & Sendable>: Decodable, Sendable {
    let items: [Value]
    let total: Int
    let page: Int
    let pageSize: Int
    let totalPages: Int
}

struct ExecuteTriggerResponse: Decodable, Sendable {
    let taskID: String
}

struct ConversationRecord: Codable, Identifiable, Sendable {
    let id: String
    let title: String?
    let userId: String
    let modelId: String?
    let summary: String?
    let messageCount: Int
    let totalTokens: Int?
    let status: String
    let isPinned: Bool
    let createdAt: String
    let updatedAt: String
}

struct MessagePart: Codable, Identifiable, Sendable {
    let type: String
    let text: String?
    let content: String?

    var id: String { "\(type)-\(text ?? content ?? UUID().uuidString)" }
    var renderedText: String? { text ?? content }
}

struct ChatMessage: Codable, Identifiable, Sendable {
    let id: String
    let conversationId: String
    let sequence: Int
    let message: MessagePayload
    let status: String
    let createdAt: String

    struct MessagePayload: Codable, Sendable {
        let role: String
        let parts: [MessagePart]
    }

    var role: String { message.role }
    var text: String { message.parts.compactMap(\.renderedText).joined() }
}

struct HomeAssistantInstance: Codable, Identifiable, Sendable {
    let id: String
    let label: String
    let baseUrl: String
    let authMode: String
    let username: String?
    let haVersion: String?
    let locationName: String?
    let status: String
    let deviceCount: Int
    let lastSyncAt: String?
    let lastError: String?
    let createdAt: String
    let updatedAt: String

    var isActive: Bool { status == "active" }
    var displayName: String { locationName?.isEmpty == false ? locationName! : label }
}

struct HomeAssistantLightState: Codable, Hashable, Sendable {
    let on: Bool
    let brightness: Double?
    let color: String?
    let colorTemp: Double?
    let colorMode: String?
    let minKelvin: Double?
    let maxKelvin: Double?
    let supportedColorModes: [String]
}

struct HomeAssistantDevice: Codable, Identifiable, Sendable {
    let id: String
    let instanceId: String
    let provider: String
    let entityId: String
    let uniqueId: String?
    let name: String
    let domain: String
    let category: String
    let categoryLabel: String
    let areaId: String?
    let areaName: String?
    let online: Bool
    let state: HomeAssistantLightState
    let lastStateAt: String?
    let createdAt: String
    let updatedAt: String

    var supportsBrightness: Bool {
        state.brightness != nil || state.supportedColorModes.contains(where: {
            ["brightness", "white", "rgb", "rgbw", "rgbww", "hs", "xy", "color_temp"].contains($0)
        })
    }

    var supportsColor: Bool {
        state.supportedColorModes.contains(where: { ["rgb", "rgbw", "rgbww", "hs", "xy"].contains($0) })
    }

    var supportsColorTemp: Bool {
        state.supportedColorModes.contains("color_temp")
    }
}

struct HomeAssistantLightCommand: Encodable, Sendable {
    var on: Bool?
    var brightness: Int?
    var color: String?
    var colorTemp: Int?
}
