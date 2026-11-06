/**
 * Reading from NEAR. "View" calls are free and need no wallet: we send a JSON-RPC
 * request straight to a public RPC node and decode the JSON the contract returns.
 */
import { config } from "./config";

export async function view<T>(contractId: string, method: string, args: object = {}): Promise<T> {
  const response = await fetch(config.nearRpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "heir",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "optimistic",
        account_id: contractId,
        method_name: method,
        args_base64: btoa(JSON.stringify(args)),
      },
    }),
  });
  const json = await response.json();
  if (json.error || json.result?.error) {
    throw new Error(json.error?.data ?? json.result?.error ?? "NEAR RPC error");
  }
  return JSON.parse(new TextDecoder().decode(new Uint8Array(json.result.result)));
}
