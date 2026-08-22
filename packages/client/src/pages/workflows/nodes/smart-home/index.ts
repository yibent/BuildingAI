import { nanoid } from "nanoid";

import iconDevice from "../../assets/icon-device.svg";
import type { FlowNodeRegistry } from "../../typings";
import { WorkflowNodeType } from "../constants";
import { formMeta } from "./form-meta";

let index = 0;

export const SmartHomeNodeRegistry: FlowNodeRegistry = {
  type: WorkflowNodeType.SmartHome,
  info: {
    icon: iconDevice,
    description: "控制已加入工程的 Home Assistant 设备，使用开关、滑条和颜色选择而不是填参数。",
  },
  meta: {
    nodePanelLabel: "智能家居",
    nodePanelVisible: false,
    size: { width: 360, height: 460 },
  },
  onAdd() {
    return {
      id: `smarthome_${nanoid(5)}`,
      type: WorkflowNodeType.SmartHome,
      data: {
        title: `智能家居_${++index}`,
        provider: "",
        deviceId: "",
        deviceName: "",
        category: "other",
        command: {},
        outputs: {
          type: "object",
          properties: {
            success: { type: "boolean", title: "执行成功" },
            deviceId: { type: "string", title: "设备 ID" },
            name: { type: "string", title: "设备名称" },
            online: { type: "boolean", title: "在线" },
            state: { type: "object", title: "设备状态" },
          },
        },
      },
    };
  },
  formMeta,
};
