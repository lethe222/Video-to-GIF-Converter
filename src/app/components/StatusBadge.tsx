import { Badge } from "./ui/badge";

type Status = "pending" | "resolved" | "rejected";

interface StatusBadgeProps {
  status: Status;
}

const statusConfig: Record<Status, { label: string; variant: "pending" | "success" | "destructive" }> = {
  pending: { label: "待处理", variant: "pending" },
  resolved: { label: "已解决", variant: "success" },
  rejected: { label: "不解决", variant: "destructive" },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.pending;
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
