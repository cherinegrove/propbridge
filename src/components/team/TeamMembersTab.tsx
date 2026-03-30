import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Loader2, ShieldAlert, Users, UserX, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { TeamMember } from "@/components/InvitationsManager";

interface Props {
  members: TeamMember[];
  loading: boolean;
  currentUserId: string | null;
  onRefresh: () => void;
}

export function TeamMembersTab({ members, loading, currentUserId, onRefresh }: Props) {
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const { toast } = useToast();

  const handleRoleChange = async (memberId: string, newRole: "admin" | "member") => {
    setUpdatingRole(memberId);
    try {
      const { data, error } = await supabase.functions.invoke("update-user-role", {
        body: { target_user_id: memberId, role: newRole },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: "Role updated", description: `User role changed to ${newRole}` });
      onRefresh();
    } catch (err: any) {
      toast({ title: "Failed to update role", description: err.message, variant: "destructive" });
    } finally {
      setUpdatingRole(null);
    }
  };

  const handleRevoke = async (memberId: string, email: string) => {
    setRevokingId(memberId);
    try {
      const { data, error } = await supabase.functions.invoke("revoke-user", {
        body: { target_user_id: memberId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: "Access revoked", description: `${email}'s access has been disabled` });
      onRefresh();
    } catch (err: any) {
      toast({ title: "Failed to revoke access", description: err.message, variant: "destructive" });
    } finally {
      setRevokingId(null);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  if (loading) {
    return (
      <div className="py-8 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <div className="text-center py-10 space-y-3">
        <div className="w-14 h-14 rounded-full bg-secondary/50 flex items-center justify-center mx-auto">
          <Users className="w-7 h-7 text-muted-foreground" />
        </div>
        <p className="text-foreground font-medium">No team members yet</p>
        <p className="text-sm text-muted-foreground">Invite colleagues to see them here</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-border/50">
            <TableHead>Member</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead>Last Active</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => {
            const isCurrentUser = member.id === currentUserId;
            return (
              <TableRow key={member.id} className="border-border/30">
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-semibold text-primary">
                      {member.email[0].toUpperCase()}
                    </div>
                    <span className="font-medium text-foreground text-sm">
                      {member.email}
                      {isCurrentUser && (
                        <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>
                      )}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  {isCurrentUser ? (
                    <Badge
                      className={
                        member.role === "admin"
                          ? "bg-primary/20 text-primary border-primary/30 hover:bg-primary/20"
                          : "bg-secondary/50 text-muted-foreground border-border/50 hover:bg-secondary/50"
                      }
                    >
                      {member.role === "admin" ? (
                        <ShieldCheck className="w-3 h-3 mr-1" />
                      ) : null}
                      {member.role}
                    </Badge>
                  ) : (
                    <div className="flex items-center gap-2">
                      {updatingRole === member.id ? (
                        <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      ) : (
                        <Select
                          value={member.role}
                          onValueChange={(val) => handleRoleChange(member.id, val as "admin" | "member")}
                        >
                          <SelectTrigger className="h-7 w-[100px] text-xs border-border/50">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="member">Member</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {formatDate(member.created_at)}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {formatDate(member.last_sign_in_at)}
                </TableCell>
                <TableCell className="text-right">
                  {!isCurrentUser && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={revokingId === member.id}
                          className="gap-1.5 text-xs h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          {revokingId === member.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <UserX className="w-3 h-3" />
                          )}
                          Revoke
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle className="flex items-center gap-2">
                            <ShieldAlert className="w-5 h-5 text-destructive" />
                            Revoke Access
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            This will immediately disable <strong>{member.email}</strong>'s account. They will no longer be able to log in.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleRevoke(member.id, member.email)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Revoke Access
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
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
