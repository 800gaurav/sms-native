package com.smssender

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.telephony.SmsManager
import android.util.Log
import androidx.core.content.ContextCompat

object SmsSender {
    private const val TAG = "SmsSender"

    fun hasPermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS) ==
            PackageManager.PERMISSION_GRANTED

    fun send(context: Context, phone: String, message: String): Boolean {
        return try {
            if (!hasPermission(context)) {
                Log.w(TAG, "SEND_SMS permission is not granted")
                return false
            }

            val cleanPhone = phone.trim()
            val cleanMessage = message.trim()
            if (cleanPhone.isBlank() || cleanMessage.isBlank()) {
                Log.w(TAG, "Phone or message is blank")
                return false
            }

            val smsManager = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                context.getSystemService(SmsManager::class.java)
            } else {
                @Suppress("DEPRECATION")
                SmsManager.getDefault()
            }

            val parts = smsManager.divideMessage(cleanMessage)
            if (parts.size == 1) {
                smsManager.sendTextMessage(cleanPhone, null, cleanMessage, null, null)
            } else {
                smsManager.sendMultipartTextMessage(cleanPhone, null, parts, null, null)
            }
            Log.d(TAG, "SMS send request queued for $cleanPhone")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to send SMS to $phone", e)
            false
        }
    }
}
