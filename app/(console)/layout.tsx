import DashboardLayout from "../dashboard/layout";

export default function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardLayout>{children}</DashboardLayout>;
}
