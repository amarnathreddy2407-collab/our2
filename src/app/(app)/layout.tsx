import { cookies } from "next/headers";
import Stars from "@/components/shared/Stars";
import { AdminAccessControl, AdminAccessProvider } from "@/components/admin/AdminAccess";
import { Sidebar, MobileNav } from "@/components/layout/Nav";
import { ADMIN_COOKIE, hasValidAdminCookie } from "@/lib/admin/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const initialAdmin = hasValidAdminCookie(cookieStore.get(ADMIN_COOKIE)?.value);
  return (
    <AdminAccessProvider initialAdmin={initialAdmin}>
      <div className="min-h-dvh px-4 pb-28 pt-6 md:pb-8 md:pl-72">
        <Stars />
        <Sidebar />
        <div className="mx-auto max-w-4xl">
          <AdminAccessControl />
          {children}
        </div>
        <MobileNav />
      </div>
    </AdminAccessProvider>
  );
}
