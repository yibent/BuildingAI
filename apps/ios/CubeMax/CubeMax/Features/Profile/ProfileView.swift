import SwiftUI

struct ProfileView: View {
    @EnvironmentObject private var model: AppModel
    @State private var workspaceSelection = "personal"
    @State private var showLogoutConfirmation = false
    @State private var modelId = ""

    private var primaryDevice: XiaozhiCubeCatDevice? {
        model.cubeCatDevices.first(where: \.online) ?? model.cubeCatDevices.first
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if let primaryDevice {
                        NavigationLink {
                            CubeCatDeviceDetailView(device: primaryDevice)
                        } label: {
                            PrimaryCubeCatCard(
                                device: primaryDevice,
                                totalCount: model.cubeCatDevices.count
                            )
                        }
                        .buttonStyle(.plain)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                    } else {
                        NavigationLink {
                            CubeCatDevicesView()
                        } label: {
                            NoCubeCatCard()
                        }
                        .buttonStyle(.plain)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                    }
                }

                if model.cubeCatDevices.count > 1 {
                    Section {
                        NavigationLink {
                            CubeCatDevicesView()
                        } label: {
                            Label {
                                HStack {
                                    Text("查看全部方糖猫")
                                    Spacer()
                                    Text("\(model.cubeCatDevices.count) 台")
                                        .foregroundStyle(.secondary)
                                }
                            } icon: {
                                Image(systemName: "square.grid.2x2")
                            }
                        }
                    }
                }

                Section("账号") {
                    HStack(spacing: 14) {
                        AsyncImage(url: URL(string: model.user?.avatar ?? "")) { image in
                            image.resizable().scaledToFill()
                        } placeholder: {
                            Text(String(model.user?.displayName.prefix(1) ?? "C"))
                                .font(.headline)
                                .foregroundStyle(.indigo)
                        }
                        .frame(width: 44, height: 44)
                        .background(.indigo.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

                        VStack(alignment: .leading, spacing: 3) {
                            Text(model.user?.displayName ?? "CubeMax 用户")
                                .font(.headline)
                            Text(model.user?.username ?? "")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }

                    if let context = model.workspaceContext, !context.choices.isEmpty {
                        Picker("当前工作区", selection: $workspaceSelection) {
                            ForEach(context.choices) { choice in
                                Label(
                                    choice.name,
                                    systemImage: choice.organizationId == nil ? "person" : "person.3"
                                )
                                .tag(choice.id)
                            }
                        }
                        .onChange(of: workspaceSelection) { _, value in
                            Task { await model.selectWorkspace(value) }
                        }
                    }
                }

                Section("服务与设置") {
                    NavigationLink {
                        SmartHomeAccountsView()
                    } label: {
                        Label {
                            HStack {
                                Text("我的智能家居")
                                Spacer()
                                if let instance = model.homeAssistant {
                                    Text(instance.displayName)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        } icon: {
                            Image(systemName: "lightbulb.2.fill")
                                .foregroundStyle(.orange)
                        }
                    }

                    TextField("默认模型 UUID（可选）", text: $modelId)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }

                Section {
                    Button("退出登录", role: .destructive) {
                        showLogoutConfirmation = true
                    }
                }
            }
            .navigationTitle("我的")
            .scrollContentBackground(.hidden)
            .background(Color(uiColor: .systemGroupedBackground))
            .task {
                workspaceSelection = model.selectedWorkspaceId ?? "personal"
                modelId = model.defaultModelId
                if model.homeAssistant == nil { await model.loadSmartHome() }
                if model.cubeCatDevices.isEmpty { await model.loadCubeCatDevices() }
            }
            .onChange(of: modelId) { _, value in model.defaultModelId = value }
            .confirmationDialog(
                "确定退出当前账号？",
                isPresented: $showLogoutConfirmation,
                titleVisibility: .visible
            ) {
                Button("退出登录", role: .destructive) {
                    Task { await model.logout() }
                }
                Button("取消", role: .cancel) {}
            }
        }
    }
}

private struct PrimaryCubeCatCard: View {
    let device: XiaozhiCubeCatDevice
    let totalCount: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topTrailing) {
                Color(uiColor: .secondarySystemGroupedBackground)
                CubeCatProductImage(device: device, height: 230)
                    .padding(.horizontal, 22)
                    .padding(.top, 8)
                Label(device.online ? "在线" : "离线", systemImage: "circle.fill")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(device.online ? .green : .secondary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    .background(.regularMaterial, in: Capsule())
                    .padding(14)
            }
            .frame(height: 245)

            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(device.displayName)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(.primary)
                    Text(device.deviceType.displayName)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Label(device.linkedAgentName ?? "尚未选择智能体", systemImage: "sparkles")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if totalCount > 1 {
                    Text("共 \(totalCount) 台")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                }
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .padding(.top, 5)
            }
            .padding(18)
        }
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(Color.primary.opacity(0.06))
        }
    }
}

private struct NoCubeCatCard: View {
    var body: some View {
        VStack(spacing: 12) {
            Image("PixelPlanet")
                .resizable()
                .scaledToFit()
                .frame(height: 112)
            Text("还没有方糖猫")
                .font(.headline)
            Text("老师或组织管理员分配设备后，会自动显示在这里。")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 26)
        .padding(.horizontal, 20)
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(Color.primary.opacity(0.06))
        }
    }
}
