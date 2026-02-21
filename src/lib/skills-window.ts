import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

export async function openSkillsManagerWindow() {
  const label = 'skills';
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }

  new WebviewWindow(label, {
    url: '/#/skills',
    title: 'Skills Manager',
    width: 1100,
    height: 750,
  });
}
