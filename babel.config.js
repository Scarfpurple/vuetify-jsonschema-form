module.exports = {
  presets: ['@babel/preset-env'],
  plugins: ['@babel/plugin-transform-runtime', ['@vue/babel-plugin-jsx', { compilerOptions: {
    isCustomElement: (tag) => ['v-jsf'].includes(tag)
  } }]]
}
