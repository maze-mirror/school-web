import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { activityDays } from '@/core'
import ActivityGrid from '../ActivityGrid.vue'

it('groups a year into labelled months without duplicated dates and aligns weekdays from Monday', async () => {
  const days = activityDays([], new Date('2025-10-22T00:00:00'), new Date('2026-10-22T00:00:00'))
  const wrapper = mount(ActivityGrid, { props: { days } })
  expect(wrapper.findAll('.heat-month')).toHaveLength(13)
  const dates = wrapper.findAll('button[data-date]').map((button) => button.attributes('data-date'))
  expect(dates).toHaveLength(365)
  expect(new Set(dates).size).toBe(365)
  expect(dates[0]).toBe('2025-10-22')
  expect(dates.at(-1)).toBe('2026-10-21')
  expect(wrapper.get('[data-month="2025-10"] .heat-month-label').text()).toBe('10月')
  expect(wrapper.findAll('[data-month="2025-10"] .heat-spacer')).toHaveLength(2)
  expect(wrapper.findAll('[data-month="2026-02"] .heat-spacer')).toHaveLength(6)
  expect(wrapper.get('.heat-weekdays').text()).toContain('周一')
  await wrapper.get('[data-date="2026-02-01"]').trigger('focus')
  expect(wrapper.emitted('update:selectedDate')?.[0]).toEqual(['2026-02-01'])
  wrapper.unmount()
})
