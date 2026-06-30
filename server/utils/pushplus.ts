interface PushPlusResponse {
  code: number
  msg: string
}

export async function sendPushPlus(token: string, title: string, content: string) {
  const response = await $fetch<PushPlusResponse>('https://www.pushplus.plus/send', {
    method: 'POST',
    body: {
      token,
      title,
      content,
      template: 'txt'
    }
  })
  if (response.code !== 200) {
    throw new Error(response.msg || 'PushPlus request failed')
  }
}
