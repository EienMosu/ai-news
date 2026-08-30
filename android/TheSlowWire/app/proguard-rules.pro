# kotlinx-serialization: the generated serializers are reached only through
# reflection on the @Serializable classes' companions, so R8 cannot see the
# link and would strip them, turning every decode into a runtime crash. The
# library ships most of this; these two rules cover our own model package.
-keepclassmembers class com.eienmosu.theslowwire.model.** {
    *** Companion;
}
-keepclasseswithmembers class com.eienmosu.theslowwire.model.** {
    kotlinx.serialization.KSerializer serializer(...);
}
