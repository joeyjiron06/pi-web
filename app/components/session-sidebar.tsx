import FileExplorerPanel from "~/components/files/file-explorer-panel";
import GitChangesPanel from "~/components/git/git-changes-panel";
import { Separator } from "~/components/ui/separator";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "~/components/ui/tabs";

export default function SessionSidebar({ cwd }: { cwd: string }) {
  return (
    <Tabs
      defaultValue="files"
      className="flex h-full min-h-0 flex-col gap-0 border-l"
    >
      {/* pr-12 keeps the tabs clear of the viewport-fixed toggle button,
          which floats above this panel's top-right corner */}
      <div className="flex h-12 shrink-0 items-center px-4 pr-12">
        <TabsList>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="git">Git</TabsTrigger>
        </TabsList>
      </div>

      <Separator />

      {/* scrolling lives inside each tab rather than in one shared wrapper:
          both tabs are resizable splits, which need a bounded height to size
          their panels against, and a ScrollArea would give them an auto one */}
      <TabsContent value="files" className="min-h-0 flex-1">
        <FileExplorerPanel cwd={cwd} />
      </TabsContent>
      <TabsContent value="git" className="min-h-0 flex-1">
        <GitChangesPanel cwd={cwd} />
      </TabsContent>
    </Tabs>
  );
}
