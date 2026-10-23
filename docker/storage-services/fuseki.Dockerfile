FROM eclipse-temurin:21-jre-alpine

ARG JENA_VERSION=6.2.0
WORKDIR /fuseki

# Use the Apache server artifact and its published checksum, as in its Docker toolkit.
RUN apk add --no-cache curl \
    && curl --fail --location --silent --show-error \
      "https://repo.maven.apache.org/maven2/org/apache/jena/jena-fuseki-server/${JENA_VERSION}/jena-fuseki-server-${JENA_VERSION}.jar" \
      --output fuseki-server.jar \
    && curl --fail --location --silent --show-error \
      "https://repo.maven.apache.org/maven2/org/apache/jena/jena-fuseki-server/${JENA_VERSION}/jena-fuseki-server-${JENA_VERSION}.jar.sha1" \
      --output fuseki-server.jar.sha1 \
    && printf '%s  fuseki-server.jar\n' "$(cat fuseki-server.jar.sha1)" | sha1sum --check - \
    && rm fuseki-server.jar.sha1 \
    && addgroup -S -g 1000 fuseki \
    && adduser -S -u 1000 -G fuseki fuseki \
    && mkdir -p /fuseki/databases \
    && chown -R fuseki:fuseki /fuseki

USER fuseki
EXPOSE 3030
ENTRYPOINT ["java", "-Xmx512m", "-jar", "/fuseki/fuseki-server.jar"]
CMD ["--tdb2", "--update", "--loc", "/fuseki/databases", "/storage"]
