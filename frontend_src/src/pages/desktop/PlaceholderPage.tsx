import { FlaskConical } from "lucide-react";

interface PlaceholderPageProps { title?: string; description?: string }

const PlaceholderPage = ({ title = "功能预览", description = "该页面将在演示版本中接入完整交互。" }: PlaceholderPageProps) => (
  <div className="paper-card flex min-h-[520px] flex-col items-center justify-center p-8 text-center">
    <FlaskConical className="size-10 text-primary" />
    <h1 className="mt-5 text-3xl font-semibold">{title}</h1>
    <p className="mt-3 max-w-md text-muted-foreground">{description}</p>
  </div>
);

export default PlaceholderPage;
