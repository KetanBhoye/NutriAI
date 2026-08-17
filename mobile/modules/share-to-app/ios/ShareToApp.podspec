require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', '..', '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ShareToApp'
  s.version        = '1.0.0'
  s.summary        = 'Hands a captured card to Snapchat as a real Snap.'
  s.license        = 'MIT'
  s.author         = 'NutriAI'
  s.homepage       = 'https://nutriai-app.up.railway.app'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => 'https://github.com/KetanBhoye/NutriAI.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Creative Kit, the only route from a third-party app into Snapchat's camera
  # preview. Declared here rather than in the app's Podfile so the dependency
  # travels with the module that needs it, and survives `expo prebuild`
  # regenerating ios/ from scratch.
  s.dependency 'SnapSDK/SCSDKCreativeKit', '~> 2.6.0'

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
