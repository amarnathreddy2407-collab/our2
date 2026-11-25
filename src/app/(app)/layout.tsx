import Stars from "@/components/shared/Stars";
import CloudFallbackNotice from "@/components/shared/CloudFallbackNotice";
import { Sidebar, MobileNav } from "@/components/layout/Nav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh px-4 pb-28 pt-6 md:pb-8 md:pl-72">
      <Stars />
      <Sidebar />
      <div className="mx-auto max-w-4xl">
        <CloudFallbackNotice />
        {children}
      </div>
      <MobileNav />
    </div>
  );
}
