/**
 * 智能体节点表单 - 配置智能体提示词切换
 */

import { Divider, Select } from "@douyinfe/semi-ui";
import { DisplayOutputs, validateFlowValue } from "@flowgram.ai/form-materials";
import type { FormMeta } from "@flowgram.ai/free-layout-editor";
import { Field } from "@flowgram.ai/free-layout-editor";

import {
  FormContent,
  FormHeader,
  FormInputs,
  FormItem,
  ReadonlyValue,
} from "../../form-components";
import { useIsSidebar, useNodeRenderContext } from "../../hooks";
import type { FlowNodeJSON, JsonSchema } from "../../typings";
import { defaultFormMeta } from "../default-form-meta";

const ACTION_LABELS: Record<string, string> = {
  switch_prompt: "切换提示词",
  enable: "启用智能体",
  disable: "停用智能体",
};

function AgentActionSelect() {
  const { readonly } = useNodeRenderContext();
  const isSidebar = useIsSidebar();

  return (
    <Field<string> name="action" defaultValue="switch_prompt">
      {({ field }) =>
        isSidebar ? (
          <FormItem name="操作类型" required type="string">
            <Select
              value={field.value}
              disabled={readonly}
              onChange={(value) => field.onChange(value as string)}
              size="small"
              style={{ width: "100%" }}
            >
              <Select.Option value="switch_prompt">切换提示词</Select.Option>
              <Select.Option value="enable" disabled>
                启用智能体（尚未接入）
              </Select.Option>
              <Select.Option value="disable" disabled>
                停用智能体（尚未接入）
              </Select.Option>
            </Select>
          </FormItem>
        ) : (
          <FormItem name="操作类型" type="string">
            <ReadonlyValue value={ACTION_LABELS[field.value ?? ""] ?? field.value ?? "未设置"} />
          </FormItem>
        )
      }
    </Field>
  );
}

function PromptNameInput() {
  const { readonly } = useNodeRenderContext();
  const isSidebar = useIsSidebar();

  return (
    <Field<string> name="promptName">
      {({ field }) =>
        isSidebar ? (
          <FormItem name="提示词名称" type="string">
            <input
              className="workflow-form-input"
              value={field.value ?? ""}
              onChange={(e) => field.onChange(e.target.value)}
              disabled={readonly}
              placeholder="例如：计时助手、导航模式..."
              style={{
                width: "100%",
                padding: "6px 10px",
                borderRadius: "6px",
                border: "1px solid var(--border-color, #e2e8f0)",
                fontSize: "13px",
              }}
            />
          </FormItem>
        ) : (
          <FormItem name="提示词名称" type="string">
            <ReadonlyValue value={field.value ?? "未设置"} />
          </FormItem>
        )
      }
    </Field>
  );
}

export const renderForm = () => {
  return (
    <>
      <FormHeader />
      <FormContent>
        <AgentActionSelect />
        <PromptNameInput />
        <Divider />
        <FormInputs />
        <div style={{ fontSize: "11px", color: "#64748b", marginTop: "4px" }}>
          下游回传端点的调用说明会自动追加到这段提示词后面，不需要手工粘贴。
        </div>
        <Divider />
        <Field<JsonSchema> name="outputs">
          {({ field }) => <DisplayOutputs value={field.value} />}
        </Field>
      </FormContent>
    </>
  );
};

export const formMeta: FormMeta<FlowNodeJSON> = {
  ...defaultFormMeta,
  render: renderForm,
  formatOnInit: (value) => {
    if (!value || typeof value !== "object") return value;
    const data = value as FlowNodeJSON & {
      prompt?: string;
      inputsValues?: Record<string, unknown>;
      inputs?: JsonSchema;
    };
    if (typeof data.prompt === "string" && data.prompt && !data.inputsValues?.prompt) {
      return {
        ...data,
        inputs: data.inputs ?? {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              title: "提示词内容",
              extra: { formComponent: "prompt-editor" },
            },
            trigger: {
              type: "string",
              title: "触发信息",
              description: "可选。来自上游的文字会追加到提示词后面。",
            },
          },
        },
        inputsValues: {
          ...data.inputsValues,
          prompt: { type: "constant", content: data.prompt },
        },
      };
    }
    return value;
  },
  validate: {
    ...defaultFormMeta.validate,
    "inputsValues.prompt": ({ value, formValues, context }) => {
      if (formValues.action && formValues.action !== "switch_prompt") return undefined;
      const property = formValues.inputs?.properties?.prompt;
      const fieldLabel =
        property && typeof property.title === "string" ? property.title : "提示词内容";
      return validateFlowValue(value, {
        node: context.node,
        required: true,
        errorMessages: {
          required: `${fieldLabel}为必填项`,
        },
      });
    },
  },
};
