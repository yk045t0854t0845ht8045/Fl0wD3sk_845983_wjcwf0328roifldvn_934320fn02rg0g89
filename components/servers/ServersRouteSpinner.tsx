import { ButtonLoader } from "@/components/login/ButtonLoader";

export function ServersRouteSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <ButtonLoader size={32} colorClassName="text-white" />
    </div>
  );
}
