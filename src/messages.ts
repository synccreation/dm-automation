export type Button =
  | { type: "postback"; title: string; payload: string }
  | { type: "web_url"; title: string; url: string };

export interface OutgoingMessage {
  text: string;
  buttons?: Button[];
}
