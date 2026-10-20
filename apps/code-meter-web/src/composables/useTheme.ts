import { ref, type Ref } from 'vue'
export function useTheme(notice: Ref<string>) {
  const theme = ref('mono')
  function setTheme() {
    try {
      localStorage.setItem('code-meter-theme', theme.value)
    } catch {
      notice.value = '主题已切换，但设置未能保存。'
    }
  }

  function loadTheme() {
    try {
      const saved = localStorage.getItem('code-meter-theme')
      if (saved === 'dark' || saved === 'mono') theme.value = saved
      else if (saved) {
        theme.value = 'mono'
        setTheme()
      }
    } catch {
      notice.value = '本地设置无法读取，已使用默认设置。'
    }
  }
  return { theme, setTheme, loadTheme }
}
