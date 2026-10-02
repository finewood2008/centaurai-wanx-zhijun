import { ConversationRecords } from "./ConversationRecords";
import { DialogueStyle } from "./DialogueStyle";

export function ConversationsPanel(props: {
  agentId: string;
  current: string | null;
  onSelect: (id: string) => void;
  onNew?: () => void;
  disabled?: boolean;
}) {
  return (
    <DialogueStyle
      key={props.agentId}
      agentId={props.agentId}
      disabled={props.disabled}
    >
      <ConversationRecords {...props} />
    </DialogueStyle>
  );
}
