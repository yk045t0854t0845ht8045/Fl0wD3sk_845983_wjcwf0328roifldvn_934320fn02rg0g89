import { ServerSettingsEditorSkeleton } from "@/components/servers/ServerSettingsEditorSkeleton";
import { serversScale } from "@/components/servers/serversScale";

export default function ServerByGuildLoading() {
  return (
    <main
      className="min-h-screen bg-black px-6"
      style={{
        paddingTop: `${serversScale.pageTopPadding}px`,
        paddingBottom: `${serversScale.pageBottomPadding}px`,
      }}
    >
      <section
        className="mx-auto w-full flowdesk-fade-up-soft"
        style={{ maxWidth: `${serversScale.maxWidth}px` }}
      >
        <ServerSettingsEditorSkeleton standalone />
      </section>
    </main>
  );
}
