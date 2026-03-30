import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Mail, RefreshCw, Copy, Loader2, Clock, CheckCircle2, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Invitation } from "@/components/InvitationsManager";

interface Props {
  invitations: Invitation[];
  loading: boolean;
  onRefresh: () => void;
}

export function SentInvitationsTab({ invitations, loading, onRefresh }: Props) {
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const { toast } = useToast();

  const handleResend = async (invitation: Invitation) => {
    setResendingId(invitation.id);
    try {
      const { data, error } = await supabase.functions.invoke("send-invitation", {
        body: { email: invitation.email, resend: true },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: "Invitation resent", description: `New invite sent to ${invitation.email}` });
      onRefresh();
    } catch (err: any) {
      toast({ title: "Failed to resend", description: err.message, variant: "destructive" });
    } finally {
      setResendingId(null);
    }
  };

  const handleCopyLink = async (invitation: Invitation) => {
    setCopyingId(invitation.id);
    try {
      const { data, error } = await supabase.functions.invoke("send-invitation", {
        body: { email: invitation.email, generate_link: true },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.link) {
        await navigator.clipboard.writeText(data.link);
        toast({ title: "Link copied!", description: "Invitation link copied to clipboard" });
      }
    } catch (err: any) {
      toast({ title: "Failed to generate link", description: err.message, variant: "destructive" });
    } finally {
      setCopyingId(null);
    }
  };

  const getStatusBadge = (invitation: Invitation) => {
    const isExpired = new Date(invitation.expires_at) < new Date();
    if (invitation.status === "accepted") {
      return (
        <Badge className="bg-green-500/20 text-green-400 border-green-500/30 hover:bg-green-500/20">
          <CheckCircle2 className="w-3 h-3 mr-1" /> Accepted
        </Badge>
      );
    }
    if (isExpired) {
      return (
        <Badge variant="destructive" className="bg-destructive/20 text-destructive border-destructive/30 hover:bg-destructive/20">
          <XCircle className="w-3 h-3 mr-1" /> Expired
        </Badge>
      );
    }
    return (
      <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/20">
        <Clock className="w-3 h-3 mr-1" /> Pending
      </Badge>
    );
  };

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  if (loading) {
    return (
      <div className="py-8 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (invitations.length === 0) {
    return (
      <div className="text-center py-10 space-y-3">
        <div className="w-14 h-14 rounded-full bg-secondary/50 flex items-center justify-center mx-auto">
          <Mail className="w-7 h-7 text-muted-foreground" />
        </div>
        <p className="text-foreground font-medium">No invitations sent yet</p>
        <p className="text-sm text-muted-foreground">Use the Invite Member button to get started</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-border/50">
            <TableHead>Email</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Sent</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invitations.map((invitation) => {
            const isPending = invitation.status !== "accepted";
            return (
              <TableRow key={invitation.id} className="border-border/30">
                <TableCell className="font-medium text-foreground">{invitation.email}</TableCell>
                <TableCell>{getStatusBadge(invitation)}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{formatDate(invitation.created_at)}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{formatDate(invitation.expires_at)}</TableCell>
                <TableCell className="text-right">
                  {isPending && (
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => handleResend(invitation)}
                        disabled={resendingId === invitation.id}
                        className="gap-1.5 text-xs h-8"
                      >
                        {resendingId === invitation.id
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <RefreshCw className="w-3 h-3" />}
                        Resend
                      </Button>
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => handleCopyLink(invitation)}
                        disabled={copyingId === invitation.id}
                        className="gap-1.5 text-xs h-8"
                      >
                        {copyingId === invitation.id
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <Copy className="w-3 h-3" />}
                        Copy Link
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
