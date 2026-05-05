package com.smssender

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class SmsServiceModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    
    override fun getName(): String = "SmsService"
    
    @ReactMethod
    fun startService() {
        SmsService.startService(reactApplicationContext)
    }
    
    @ReactMethod
    fun stopService() {
        SmsService.stopService(reactApplicationContext)
    }
}
