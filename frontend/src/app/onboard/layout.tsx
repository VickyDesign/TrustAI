import { AuthGate } from "@/components/auth";

export default function OnboardLayout({ children }: { children: React.ReactNode }) {
  return <AuthGate>{children}</AuthGate>;
}
