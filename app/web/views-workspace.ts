export async function loadViewsWorkspace<T>(inspect: (route: "views" | "designs") => Promise<T>) {
  const views = await inspect("views");
  const designs = await inspect("designs");
  return { views, designs };
}
