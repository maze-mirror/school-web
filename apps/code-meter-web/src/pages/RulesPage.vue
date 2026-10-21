<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { introduction } from '@/content/introduction'

const props = defineProps<{ target?: string }>()
const activeId = ref('getting-started')
const expanded = ref(['features'])
const heading = ref<HTMLElement | null>(null)
const topics = introduction.flatMap((group) => group.topics)
const article = computed(() => topics.find((topic) => topic.id === activeId.value) ?? topics[0]!)
const currentGroup = computed(() =>
  introduction.find((group) => group.topics.some((topic) => topic.id === article.value.id))!,
)
function toggleGroup(id: string) {
  expanded.value = expanded.value.includes(id)
    ? expanded.value.filter((item) => item !== id)
    : [...expanded.value, id]
}
async function selectTopic(id: string, focus = true) {
  if (!topics.some((topic) => topic.id === id)) return
  activeId.value = id
  if (!expanded.value.includes(currentGroup.value.id)) expanded.value.push(currentGroup.value.id)
  if (!focus) return
  await nextTick()
  heading.value?.focus({ preventScroll: true })
  heading.value?.scrollIntoView?.({ block: 'start' })
}
watch(
  () => props.target,
  (target) => {
    if (target) void selectTopic(target)
  },
  { immediate: true },
)
</script>
<template>
  <section class="rules-section introduction-layout">
    <aside class="introduction-sidebar" aria-label="项目介绍目录">
      <h2>项目介绍</h2>
      <div v-for="group in introduction" :key="group.id" class="introduction-group">
        <button
          class="introduction-group-toggle"
          :aria-expanded="expanded.includes(group.id)"
          :aria-controls="`topics-${group.id}`"
          @click="toggleGroup(group.id)"
        >
          {{ group.title
          }}<span aria-hidden="true">{{ expanded.includes(group.id) ? '−' : '+' }}</span>
        </button>
        <ul v-if="expanded.includes(group.id)" :id="`topics-${group.id}`">
          <li v-for="topic in group.topics" :key="topic.id">
            <a
              :href="`#${topic.id}`"
              :aria-current="activeId === topic.id ? 'page' : undefined"
              @click.prevent="selectTopic(topic.id)"
              >{{ topic.title }}</a
            >
          </li>
        </ul>
      </div>
    </aside>
    <article class="introduction-article" :aria-labelledby="article.id">
      <p class="eyebrow">项目介绍 / {{ currentGroup.title }}</p>
      <h2 :id="article.id" ref="heading" tabindex="-1">{{ article.title }}</h2>
      <p class="introduction-summary">{{ article.summary }}</p>
      <div
        v-if="article.id === 'activity-method'"
        class="activity-example"
        aria-label="累计示例：100 行加 120 行等于当天 220 行"
      >
        <span>上午<span>100 行 · Python</span></span
        ><b aria-hidden="true">＋</b><span>晚上<span>120 行 · C++</span></span
        ><b aria-hidden="true">＝</b><span>当天累计<strong>220 行</strong></span>
      </div>
      <div class="introduction-body">
        <p v-for="paragraph in article.paragraphs" :key="paragraph">{{ paragraph }}</p>
      </div>
    </article>
  </section>
</template>
