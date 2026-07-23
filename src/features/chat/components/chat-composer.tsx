import { ArrowUp, Square } from "lucide-react";
import { useState, type FormEvent, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type ChatComposerProps = {
  disabled: boolean;
  streaming: boolean;
  onSend: (text: string) => Promise<void>;
  onStop: () => Promise<void>;
};

export function ChatComposer({
  disabled,
  streaming,
  onSend,
  onStop,
}: ChatComposerProps) {
  const [input, setInput] = useState("");

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const text = input.trim();
    if (!text || disabled) return;
    setInput("");
    await onSend(text);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <form className="composer" onSubmit={submit}>
      <Textarea
        aria-label="输入消息"
        autoFocus
        maxLength={4_000}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="把问题交给 Supervisor..."
        value={input}
      />
      <div className="composer-footer">
        <span>Enter 发送 · Shift + Enter 换行</span>
        {streaming ? (
          <Button aria-label="停止生成" onClick={onStop} size="icon" type="button">
            <Square className="size-4 fill-current" />
          </Button>
        ) : (
          <Button
            aria-label="发送消息"
            disabled={disabled || !input.trim()}
            size="icon"
            type="submit"
          >
            <ArrowUp className="size-5" />
          </Button>
        )}
      </div>
    </form>
  );
}
