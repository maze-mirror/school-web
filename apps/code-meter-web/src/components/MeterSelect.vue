<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
const props = defineProps<{
  modelValue: string
  options: { value: string; label: string }[]
  label: string
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; change: [] }>()
const id = useId()
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const open = ref(false)
const active = ref(0)
const selected = computed(
  () => props.options.find((o) => o.value === props.modelValue)?.label ?? '请选择',
)
function show() {
  if (props.disabled || !props.options.length) return
  active.value = Math.max(
    0,
    props.options.findIndex((o) => o.value === props.modelValue),
  )
  open.value = true
}
function select(index: number) {
  const option = props.options[index]
  if (!option || props.disabled) return
  emit('update:modelValue', option.value)
  emit('change')
  open.value = false
  trigger.value?.focus()
}
function keydown(e: KeyboardEvent) {
  if (props.disabled) return
  if (e.key === 'Escape') {
    open.value = false
    return
  }
  if (e.key === 'Tab') {
    open.value = false
    return
  }
  if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(e.key)) {
    e.preventDefault()
    if (!open.value) {
      show()
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      select(active.value)
      return
    }
    if (e.key === 'Home') active.value = 0
    else if (e.key === 'End') active.value = props.options.length - 1
    else
      active.value =
        (active.value + (e.key === 'ArrowDown' ? 1 : -1) + props.options.length) %
        props.options.length
  } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    show()
    const found = props.options.findIndex((o) =>
      o.label.toLowerCase().startsWith(e.key.toLowerCase()),
    )
    if (found >= 0) active.value = found
  }
}
function outside(e: Event) {
  if (!root.value?.contains(e.target as Node)) open.value = false
}
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) open.value = false
  },
)
onMounted(() => {
  document.addEventListener('pointerdown', outside)
  document.addEventListener('focusin', outside)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', outside)
  document.removeEventListener('focusin', outside)
})
</script>
<template>
  <div ref="root" class="meter-select">
    <button
      ref="trigger"
      type="button"
      class="select-trigger"
      role="combobox"
      :aria-label="label"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="id"
      :aria-activedescendant="open ? id + '-' + active : undefined"
      :disabled="disabled"
      @click="open ? (open = false) : show()"
      @keydown="keydown"
    >
      <span>{{ selected }}</span
      ><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.2" />
      </svg>
    </button>
    <div v-if="open" :id="id" class="select-menu" role="listbox" :aria-label="label">
      <div
        v-for="(option, index) in options"
        :id="id + '-' + index"
        :key="option.value"
        role="option"
        :aria-selected="modelValue === option.value"
        :class="['select-option', { active: active === index }]"
        @pointermove="active = index"
        @mousedown.prevent
        @click="select(index)"
      >
        <span>{{ option.label }}</span
        ><span class="select-check" aria-hidden="true">{{
          modelValue === option.value ? '✓' : ''
        }}</span>
      </div>
    </div>
  </div>
</template>
