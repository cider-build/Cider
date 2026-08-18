import { Schema } from "effect";

const ControlId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{32}$/));
const Headers = Schema.Record(Schema.String, Schema.String);

export const GatewayMethod = Schema.Literals(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);
export type GatewayMethod = typeof GatewayMethod.Type;

export const GatewayResponseControl = Schema.Struct({
  type: Schema.Literal("response"),
  id: ControlId,
  status: Schema.Int.check(Schema.isGreaterThanOrEqualTo(100), Schema.isLessThanOrEqualTo(599)),
  headers: Schema.optionalKey(Headers),
});

export const GatewayHeartbeat = Schema.Struct({
  type: Schema.Literal("heartbeat"),
});

export const GatewaySshError = Schema.Struct({
  type: Schema.Literal("ssh_error"),
  id: ControlId,
  detail: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

export const GatewayInboundControl = Schema.Union([
  GatewayResponseControl,
  GatewayHeartbeat,
  GatewaySshError,
]);
export type GatewayInboundControl = typeof GatewayInboundControl.Type;

export const GatewayRequestControl = Schema.Struct({
  type: Schema.Literal("request"),
  id: ControlId,
  method: GatewayMethod,
  path: Schema.String,
  headers: Headers,
  body_length: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export const GatewayHeartbeatAck = Schema.Struct({
  type: Schema.Literal("heartbeat_ack"),
});

export const GatewaySshOpen = Schema.Struct({
  type: Schema.Literal("ssh_open"),
  id: ControlId,
  sandbox_id: Schema.String,
});

export const GatewayOutboundControl = Schema.Union([
  GatewayRequestControl,
  GatewayHeartbeatAck,
  GatewaySshOpen,
]);
export type GatewayOutboundControl = typeof GatewayOutboundControl.Type;

export interface GatewayResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}
