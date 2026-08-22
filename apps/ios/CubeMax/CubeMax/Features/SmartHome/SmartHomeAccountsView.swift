import SwiftUI

struct SmartHomeAccountsView: View {
    @EnvironmentObject private var model: AppModel
    @State private var isSyncing = false

    var body: some View {
        List {
            Section {
                NavigationLink {
                    SmartHomeDevicesView()
                } label: {
                    Label("查看全部设备", systemImage: "rectangle.3.group.fill")
                }
            }

            Section("Home Assistant") {
                if let instance = model.homeAssistant {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Image(systemName: instance.isActive ? "checkmark.shield.fill" : "exclamationmark.shield.fill")
                                .foregroundStyle(instance.isActive ? .green : .orange)
                            Text(instance.displayName).font(.subheadline.weight(.semibold))
                        }
                        Text(instance.baseUrl)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text("\(instance.deviceCount) 个设备\(instance.haVersion.map { " · v\($0)" } ?? "")")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        if let lastError = instance.lastError, !lastError.isEmpty {
                            Text(lastError).font(.caption).foregroundStyle(.red)
                        }
                    }
                    .padding(.vertical, 4)
                } else {
                    Text("尚未连接 Home Assistant。请在网页设置中填写地址和令牌。")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("我的智能家居")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task {
                        isSyncing = true
                        try? await model.syncHomeAssistant()
                        isSyncing = false
                    }
                } label: {
                    if isSyncing { ProgressView() } else { Image(systemName: "arrow.clockwise") }
                }
                .disabled(model.homeAssistant == nil || isSyncing)
                .accessibilityLabel("同步设备")
            }
        }
        .refreshable { await model.loadSmartHome() }
        .task { await model.loadSmartHome() }
    }
}
