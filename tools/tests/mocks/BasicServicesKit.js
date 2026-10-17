// BasicServicesKit 运行时 mock（单测用）：只提供 `deviceInfo` 的固定值。
// 说明：`BusinessError` 是**类型**（tsc 会擦除），`deviceInfo` 是**值** ⇒ 必须真有实现，
// 否则任何 `import pushreg` 的单测都会 MODULE_NOT_FOUND。
module.exports = {
  deviceInfo: {
    brand: 'HUAWEI',
    marketName: 'Mock Phone',
    productModel: 'MOCK-AL00',
    osFullName: 'HarmonyOS 7.0.0 (mock)',
  },
};
