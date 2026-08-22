import { Divider } from "@douyinfe/semi-ui";
import { DisplayOutputs } from "@flowgram.ai/form-materials";
import type { FormMeta } from "@flowgram.ai/free-layout-editor";

import { FormContent, FormHeader } from "../../form-components";
import { defaultFormMeta } from "../default-form-meta";
import { SmartHomeDevicePanel } from "./device-panel";

export const renderForm = () => (
  <>
    <FormHeader />
    <FormContent>
      <SmartHomeDevicePanel />
      <Divider />
      <DisplayOutputs displayFromScope />
    </FormContent>
  </>
);

export const formMeta: FormMeta = {
  ...defaultFormMeta,
  render: renderForm,
  validate: {
    ...defaultFormMeta.validate,
    provider: ({ value }: { value?: string }) =>
      value === "homeassistant" ? undefined : "请选择 Home Assistant 设备",
    deviceId: ({ value }: { value?: string }) => (value ? undefined : "请选择物联网设备"),
  },
};
