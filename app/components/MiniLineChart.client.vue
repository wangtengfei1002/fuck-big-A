<script setup lang="ts">
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { use } from 'echarts/core'
import VChart from 'vue-echarts'

const props = defineProps<{
  values: number[]
  positive?: boolean
}>()

use([CanvasRenderer, LineChart, GridComponent, TooltipComponent])

const option = computed(() => ({
  animation: false,
  grid: { top: 8, right: 6, bottom: 8, left: 6 },
  tooltip: {
    trigger: 'axis',
    borderWidth: 0,
    textStyle: { fontSize: 11 }
  },
  xAxis: {
    type: 'category',
    show: false,
    data: props.values.map((_, index) => index + 1)
  },
  yAxis: {
    type: 'value',
    show: false,
    scale: true
  },
  series: [
    {
      type: 'line',
      data: props.values,
      smooth: true,
      symbol: 'none',
      lineStyle: {
        width: 2,
        color: props.positive ? '#dc2626' : '#16a34a'
      },
      areaStyle: {
        opacity: 0.12,
        color: props.positive ? '#dc2626' : '#16a34a'
      }
    }
  ]
}))
</script>

<template>
  <VChart class="h-full w-full" :option="option" autoresize />
</template>
