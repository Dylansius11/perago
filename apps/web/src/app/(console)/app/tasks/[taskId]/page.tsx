import { TaskJourney } from "@/components/console/task-journey";

export default async function TaskPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  return <TaskJourney taskId={taskId} />;
}
