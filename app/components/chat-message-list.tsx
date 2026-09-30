import { useMemo } from "react";
import { useMessageCount, useSelector } from "~/store/selectors";
import { ChatMessage } from "./chat-message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "~/components/ui/message-scroller";
import { Skeleton } from "./ui/skeleton";

type Props = {
  sessionId: string;
};

export default function ChatMessageList({ sessionId }: Props) {
  const messageCount = useMessageCount(sessionId);
  const messages = useSelector(
    (state) => state.sessions[sessionId]?.messages ?? [],
  );
  const messageIndices = useMemo(
    () => Array.from({ length: messageCount }, (_, i) => i),
    [messageCount],
  );

  return (
    <MessageScrollerProvider>
      <MessageScroller>
        <MessageScrollerViewport>
          <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-2 px-4 pb-6 pt-10">
            {messageIndices.map((messageIndex) => (
              <MessageScrollerItem
                key={messageIndex}
                messageId={String(messageIndex)}
                scrollAnchor={messages[messageIndex]?.role === "user"}
                className="empty:hidden"
              >
                <ChatMessage
                  key={messageIndex}
                  sessionId={sessionId}
                  messageIndex={messageIndex}
                />
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

export function ChatMessagesSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-10">
      <Skeleton className="h-16 w-2/3 self-end" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-16 w-1/2" />
    </div>
  );
}
