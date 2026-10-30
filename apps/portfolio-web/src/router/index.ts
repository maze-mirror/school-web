import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: '/sailing_log/',
    },
    {
      path: '/sailing_log/:pathMatch(.*)*',
      name: 'sailing_log',
      component: () => import('../pages/PortfolioIndex.vue'),
    },
    { path: '/about', redirect: '/sailing_log/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

export default router
