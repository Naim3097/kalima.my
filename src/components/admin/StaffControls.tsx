"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { addRoleGrant, removeRoleGrant, setUserRole } from "@/app/admin/actions";
import { Table, Td, Tr } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { RoleGrant } from "@/lib/admin";

const ROLES = ["customer", "staff", "admin", "affiliate"] as const;
type Role = (typeof ROLES)[number];

const ROLE_LABEL: Record<Role, string> = {
  customer: "Customer",
  staff: "Staff",
  admin: "Admin",
  affiliate: "Affiliate",
};

const dateFmt = new Intl.DateTimeFormat("en-MY", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/*
  Per-user role picker. Changing the Select calls setUserRole; the action
  guards against an admin self-demoting and returns an error we surface as a
  toast (the Select reverts to its server value on the next revalidation).
*/
export function RoleSelect({ userId, role }: { userId: string; role: string }) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(role);

  function change(next: string) {
    if (next === value) return;
    const previous = value;
    setValue(next);
    startTransition(async () => {
      const res = await setUserRole(userId, next);
      if ("error" in res) {
        toast.error(res.error);
        setValue(previous);
        return;
      }
      toast.success(`Role updated to ${ROLE_LABEL[next as Role] ?? next}.`);
    });
  }

  return (
    <Select value={value} onValueChange={change} disabled={pending}>
      <SelectTrigger className="h-8 w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLES.map((r) => (
          <SelectItem key={r} value={r}>
            {ROLE_LABEL[r]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/*
  The bootstrap allowlist: an add-form (email + role) plus a per-row remove.
  An email listed here is granted its role automatically the first time it
  signs up, so staff can be pre-authorized before they have an account.
*/
export function RoleGrantManager({ grants }: { grants: RoleGrant[] }) {
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("staff");

  function add() {
    const clean = email.trim().toLowerCase();
    if (!clean) {
      toast.error("Enter an email.");
      return;
    }
    startTransition(async () => {
      const res = await addRoleGrant(clean, role);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Allowlist entry added.");
      setEmail("");
      setRole("staff");
    });
  }

  function remove(target: string) {
    startTransition(async () => {
      const res = await removeRoleGrant(target);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Allowlist entry removed.");
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 border-b border-navy/10 px-5 py-4">
        <div className="min-w-[220px] flex-1 space-y-2">
          <label htmlFor="grant-email" className="label-caps text-navy-400">
            Email
          </label>
          <Input
            id="grant-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="staff@kalima.my"
          />
        </div>
        <div className="w-36 space-y-2">
          <label className="label-caps text-navy-400">Role</label>
          <Select value={role} onValueChange={(v) => setRole(v as Role)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {ROLE_LABEL[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="kalima"
          size="editorial"
          className="cursor-pointer px-4 py-2.5"
          onClick={add}
          disabled={pending}
        >
          Add
        </Button>
      </div>

      {grants.length === 0 ? (
        <p className="px-5 py-10 text-center text-[13px] text-navy-400">
          No pre-authorized emails yet. Add one above to grant a role before sign-up.
        </p>
      ) : (
        <Table head={["Email", "Role", "Added", ""]}>
          {grants.map((g) => (
            <Tr key={g.email}>
              <Td className="font-medium">{g.email}</Td>
              <Td className="text-navy-400">{ROLE_LABEL[g.role as Role] ?? g.role}</Td>
              <Td className="text-navy-400">{dateFmt.format(new Date(g.createdAt))}</Td>
              <Td className="text-right">
                <Button
                  variant="kalimaOutline"
                  size="sm"
                  className="cursor-pointer"
                  onClick={() => remove(g.email)}
                  disabled={pending}
                >
                  Remove
                </Button>
              </Td>
            </Tr>
          ))}
        </Table>
      )}
    </div>
  );
}
