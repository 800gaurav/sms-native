import { AppRegistry, NativeModules, Platform } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import App from './App';
import { name as appName } from './app.json';

// Background/Killed state mein FCM message aane pe SMS bhejo
messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  if (Platform.OS !== 'android') return;
  const { type, phone, message } = remoteMessage.data || {};
  if (type !== 'send_sms' || !phone || !message) return;

  const SmsModule = NativeModules.SmsModule;
  if (SmsModule) {
    SmsModule.sendSms(phone, message);
  }
});

AppRegistry.registerComponent(appName, () => App);
