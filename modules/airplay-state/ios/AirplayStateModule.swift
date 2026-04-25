import AVFoundation
import ExpoModulesCore

public class AirplayStateModule: Module {
  private var routeChangeObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("AirplayState")

    Events("routeChange")

    AsyncFunction("isActive") { () -> Bool in
      return AirplayStateModule.isAirPlayActive()
    }

    OnStartObserving {
      let observer = NotificationCenter.default.addObserver(
        forName: AVAudioSession.routeChangeNotification,
        object: nil,
        queue: nil
      ) { [weak self] _ in
        self?.sendEvent("routeChange", [
          "isActive": AirplayStateModule.isAirPlayActive()
        ])
      }
      self.routeChangeObserver = observer
    }

    OnStopObserving {
      if let observer = self.routeChangeObserver {
        NotificationCenter.default.removeObserver(observer)
        self.routeChangeObserver = nil
      }
    }
  }

  private static func isAirPlayActive() -> Bool {
    let outputs = AVAudioSession.sharedInstance().currentRoute.outputs
    for output in outputs {
      switch output.portType {
      case .airPlay, .bluetoothA2DP:
        // .airPlay covers most AirPlay receivers; some Bluetooth speakers also
        // appear as AirPlay-style remote outputs but we only care about airPlay
        // for video routing.
        if output.portType == .airPlay {
          return true
        }
      default:
        continue
      }
    }
    return false
  }
}
