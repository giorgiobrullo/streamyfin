Pod::Spec.new do |s|
  s.name           = 'AirplayState'
  s.version        = '1.0.0'
  s.summary        = 'Audio session route observation for AirPlay state'
  s.description    = 'Reports whether the system audio session is currently routed to an AirPlay output.'
  s.author         = ''
  s.homepage       = 'https://github.com/streamyfin/streamyfin'
  s.platforms      = {
    :ios => '15.1',
    :tvos => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }

  s.source_files = "*.{h,m,swift}"
end
