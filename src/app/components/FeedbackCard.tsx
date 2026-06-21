import { useState } from "react";
import { Check, X, Clock, Star, User, Mail, MessageSquare, Calendar } from "lucide-react";
import { Card, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { StatusBadge } from "./StatusBadge";

interface Feedback {
  id: string;
  name: string;
  email: string;
  message: string;
  rating: number | null;
  type: string;
  status: "pending" | "resolved" | "rejected";
  reason: string;
  createdAt: string;
  updatedAt: string | null;
}

interface FeedbackCardProps {
  feedback: Feedback;
  onUpdate: (id: string, status: string, reason: string) => Promise<void>;
}

export function FeedbackCard({ feedback, onUpdate }: FeedbackCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [newStatus, setNewStatus] = useState(feedback.status);
  const [reason, setReason] = useState(feedback.reason || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onUpdate(feedback.id, newStatus, reason);
    setIsEditing(false);
    setSaving(false);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const renderStars = (rating: number | null) => {
    if (!rating) return null;
    return (
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`w-4 h-4 ${
              star <= rating ? "fill-yellow-400 text-yellow-400" : "text-gray-300"
            }`}
          />
        ))}
      </div>
    );
  };

  return (
    <Card className={`transition-all ${expanded ? "ring-2 ring-primary/20" : ""}`}>
      <CardContent className="p-4">
        <div
          className="cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <StatusBadge status={feedback.status} />
                {feedback.rating && renderStars(feedback.rating)}
              </div>
              <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                {feedback.message}
              </p>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <User className="w-3 h-3" />
                  {feedback.name}
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {formatDate(feedback.createdAt)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {expanded && (
          <div className="mt-4 pt-4 border-t space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">用户名：</span>
                <span className="font-medium">{feedback.name}</span>
              </div>
              <div>
                <span className="text-muted-foreground">邮箱：</span>
                <span className="font-medium">{feedback.email || "未提供"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">类型：</span>
                <span className="font-medium">{feedback.type}</span>
              </div>
              <div>
                <span className="text-muted-foreground">ID：</span>
                <span className="font-mono text-xs">{feedback.id}</span>
              </div>
            </div>

            <div>
              <span className="text-muted-foreground text-sm">反馈内容：</span>
              <p className="mt-1 p-3 bg-muted rounded-lg text-sm whitespace-pre-wrap">
                {feedback.message}
              </p>
            </div>

            {feedback.reason && (
              <div>
                <span className="text-muted-foreground text-sm">不解决原因：</span>
                <p className="mt-1 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                  {feedback.reason}
                </p>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsEditing(!isEditing)}
              >
                {isEditing ? "取消" : "修改状态"}
              </Button>
            </div>

            {isEditing && (
              <div className="space-y-3 p-3 bg-muted/50 rounded-lg">
                <div>
                  <label className="text-sm font-medium mb-1 block">状态</label>
                  <Select value={newStatus} onValueChange={setNewStatus}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-yellow-500" />
                          待处理
                        </div>
                      </SelectItem>
                      <SelectItem value="resolved">
                        <div className="flex items-center gap-2">
                          <Check className="w-4 h-4 text-green-500" />
                          已解决
                        </div>
                      </SelectItem>
                      <SelectItem value="rejected">
                        <div className="flex items-center gap-2">
                          <X className="w-4 h-4 text-red-500" />
                          不解决
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {newStatus === "rejected" && (
                  <div>
                    <label className="text-sm font-medium mb-1 block">不解决原因</label>
                    <Input
                      placeholder="请填写不解决的原因..."
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </div>
                )}

                <Button
                  className="w-full"
                  onClick={handleSave}
                  disabled={saving || (newStatus === "rejected" && !reason.trim())}
                >
                  {saving ? "保存中..." : "保存"}
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
