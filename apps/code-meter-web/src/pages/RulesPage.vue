<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { introduction } from '@/content/introduction'

const props = defineProps<{ target?: string }>()
const activeId = ref('features')
const articleElement = ref<HTMLElement | null>(null)
const article = computed(() => introduction.find((section) => section.id === activeId.value)!)

async function selectSection(id: string) {
  const section = introduction.find(
    (item) => item.id === id || item.paragraphs.some((paragraph) => paragraph.id === id),
  )
  if (!section) return
  activeId.value = section.id
  await nextTick()
  const target = articleElement.value?.querySelector<HTMLElement>(`[id="${id}"]`)
  target?.focus({ preventScroll: true })
  target?.scrollIntoView?.({ block: 'start' })
}

watch(
  () => props.target,
  (target) => {
    if (target) void selectSection(target)
  },
  { immediate: true },
)
</script>
<template>
  <section class="rules-section introduction-layout">
    <aside class="introduction-sidebar" aria-label="项目介绍目录">
      <h2>项目介绍</h2>
      <nav aria-label="介绍章节">
        <a
          v-for="section in introduction"
          :key="section.id"
          :href="`#${section.id}`"
          :aria-current="activeId === section.id ? 'page' : undefined"
          @click.prevent="selectSection(section.id)"
          >{{ section.title }}</a
        >
      </nav>
    </aside>
    <article ref="articleElement" class="introduction-article" :aria-labelledby="article.id">
      <p class="eyebrow">CODE / METER</p>
      <h2 :id="article.id" tabindex="-1">{{ article.title }}</h2>
      <p class="introduction-summary">{{ article.summary }}</p>
      <div class="introduction-body">
        <p
          v-for="paragraph in article.paragraphs"
          :id="paragraph.id"
          :key="paragraph.text"
          :tabindex="paragraph.id ? -1 : undefined"
        >
          {{ paragraph.text }}
        </p>
      </div>
    </article>
  </section>
</template>
