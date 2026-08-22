import SwiftUI

struct SmartHomeDevicesView: View {
    @EnvironmentObject private var model: AppModel
    @State private var selectedDevice: HomeAssistantDevice?
    @State private var category = "全部"

    private var devices: [HomeAssistantDevice] {
        guard category != "全部" else { return model.devices }
        return model.devices.filter { $0.categoryLabel == category }
    }

    private var categories: [String] {
        ["全部"] + Array(Set(model.devices.map(\.categoryLabel))).sorted()
    }

    var body: some View {
        Group {
            if model.homeAssistant == nil {
                EmptyStateView(icon: "homekit", title: "尚未连接", message: "请先在网页设置中连接 Home Assistant。")
            } else if devices.isEmpty {
                EmptyStateView(icon: "lightbulb.slash", title: "没有设备", message: "先在 Home Assistant 里接入灯，再点同步。")
            } else {
                List {
                    if categories.count > 1 {
                        Section {
                            Picker("设备分类", selection: $category) {
                                ForEach(categories, id: \.self) { Text($0).tag($0) }
                            }
                            .pickerStyle(.menu)
                        }
                    }
                    Section {
                        ForEach(devices) { device in
                            Button { selectedDevice = device } label: { DeviceRow(device: device) }
                                .buttonStyle(.plain)
                        }
                    }
                }
                .listStyle(.insetGrouped)
            }
        }
        .navigationTitle("全部设备")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { Task { await model.loadSmartHome() } } label: { Image(systemName: "arrow.clockwise") }
                    .accessibilityLabel("刷新设备")
            }
        }
        .refreshable { await model.loadSmartHome() }
        .task { if model.devices.isEmpty { await model.loadSmartHome() } }
        .sheet(item: $selectedDevice) { device in DeviceControlView(device: device) }
    }
}

private struct DeviceRow: View {
    let device: HomeAssistantDevice

    var body: some View {
        HStack(spacing: 13) {
            Image(systemName: device.online ? "lightbulb.2.fill" : "lightbulb.slash")
                .foregroundStyle(device.online ? .orange : .secondary)
                .frame(width: 34, height: 34)
                .background((device.online ? Color.orange : Color.secondary).opacity(0.12), in: Circle())
            VStack(alignment: .leading, spacing: 4) {
                Text(device.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                Text([device.categoryLabel, device.areaName].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            Circle().fill(device.online ? .green : .gray).frame(width: 8, height: 8)
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
        }
        .padding(.vertical, 5)
    }
}
