import { BeecodeClient, HttpAgentTransport } from "@beecode/client-sdk";

export const webTransport = new HttpAgentTransport();
export const agentClient = new BeecodeClient(webTransport);
