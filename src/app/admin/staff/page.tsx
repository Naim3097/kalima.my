import type { Metadata } from "next";
import { RoleGrantManager, RoleSelect } from "@/components/admin/StaffControls";
import { Card, CardHeader, Table, Td, Tr } from "@/components/admin/ui";
import { listRoleGrants, listUsers } from "@/lib/admin";

export const metadata: Metadata = {
  title: "Staff & Roles · Admin",
  description: "Manage team member roles and the pre-authorization allowlist.",
};

const dateFmt = new Intl.DateTimeFormat("en-MY", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/* Server Component — loads all users and the role_grants allowlist. */
export default async function AdminStaffPage() {
  const [users, grants] = await Promise.all([listUsers(), listRoleGrants()]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-navy">Staff & Roles</h1>
        <p className="mt-1 text-[13px] tracking-wide text-navy-400">
          Assign roles to team members and pre-authorize new staff before they sign up.
        </p>
      </div>

      <Card>
        <CardHeader title="Team & roles" />
        {users.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-navy-400">No users yet.</p>
        ) : (
          <Table head={["Name", "Email", "Role", "Joined"]}>
            {users.map((u) => (
              <Tr key={u.id}>
                <Td className="font-medium">{u.name ?? "—"}</Td>
                <Td className="text-navy-400">{u.email}</Td>
                <Td>
                  <RoleSelect userId={u.id} role={u.role} />
                </Td>
                <Td className="text-navy-400">{dateFmt.format(new Date(u.createdAt))}</Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="Access allowlist" />
        <p className="border-b border-navy/10 px-5 py-3 text-[12px] leading-relaxed tracking-wide text-navy-400">
          An email here is granted its role automatically the moment it signs up — how you pre-authorize staff
          before they have an account.
        </p>
        <RoleGrantManager grants={grants} />
      </Card>
    </div>
  );
}
