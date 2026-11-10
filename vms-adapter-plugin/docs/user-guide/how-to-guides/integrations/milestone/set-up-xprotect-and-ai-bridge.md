# Set Up XProtect and AI Bridge

This page prepares Milestone XProtect and Milestone AI Bridge for VMS Adapter Plugin (VAP). When you finish,
AI Bridge is attached to XProtect, and you have checked that it lists your cameras and
restreams their video.

For background on each component, see the [overview](./index.md).

## Hosts

| Host | OS | Runs |
| --- | --- | --- |
| XProtect host | Windows 11 Pro* | XProtect Management Server, Recording Server, Event Server, Management Client. Smart Client can run here or on an operator PC. |
| AI Bridge host | Ubuntu 24.04 with Docker | Milestone AI Bridge containers |
| Analytics host | Ubuntu 24.04 with Docker and Docker Compose, Intel GPU recommended | VAP and Loitering Detection |

The AI Bridge host and the analytics host can be the same machine.

>*While Milestone docs specifies an exhaustive list of supported OS, the ones mentioned are tested for integration.

## Network

Ports between the hosts:

| From | To | Port | Purpose |
| --- | --- | --- | --- |
| AI Bridge | XProtect | 80 or 443 | Management Server |
| AI Bridge | XProtect | 7563 | Recording Server, video for the restream |
| AI Bridge | XProtect | 22331 | Event Server, analytics events |
| VAP | AI Bridge | 4000 | GraphQL: discovery and registration |
| VAP | AI Bridge | 8382 | Topic sinks: metadata frames and analytics events |
| DLSPS | AI Bridge | 8554 | RTSP restream of the cameras |
| Management Client | VAP | 3443 | VAP pages shown in Management Client |

Ports 4000, 8382 and 8554 are exposed directly when AI Bridge runs in debug mode. A
production deployment routes them through the AI Bridge proxy; see the
[AI Bridge documentation](https://doc.milestonesys.com/AIB/Help/latest/en-us/).

> [!IMPORTANT]
> **Name resolution.** XProtect gives AI Bridge the Management Server's *hostname*, and
> AI Bridge uses it to reach the Event Server (for example
> `http://<management-server-hostname>:22331/...`). The AI Bridge host must resolve that
> name. If it is not in DNS, add it to the AI Bridge containers' `extra_hosts` or the
> host's `/etc/hosts`. Likewise, the XProtect host must resolve the VAP hostname you set
> as `AIB_APP_HOSTNAME`. Read further to understand more.

## Step 1: Install XProtect and add a camera

1. Install XProtect by following Milestone's
   [XProtect installation guide](https://doc.milestonesys.com/xprotect/xprotect-management-client/2026r2/en/install-a-new-xprotect-system.html). This guide was tested
   with XProtect Professional+ 2026 R1 on a single computer running Win 11 Pro 25H2.

   Management Client is automatically installed automatically.

2. In Management Client, go to **Recording Servers**, right-click your recording server,
   and choose **Add Hardware** to add your camera. If your camera requires a username password, add those during the wizard setup when asked.
3. Open the camera in Smart Client and check that live video plays.

<!-- SCREENSHOT TODO: ../../../_assets/milestone-mc-add-hardware.png
     Management Client > Recording Servers, with the camera added under the recording server. -->

> [!NOTE]
> VAP needs each camera's resolution to place the loitering zone, and reads it from
> XProtect through AI Bridge. Cameras added with a real driver, such as the AXIS camera
> used in testing, report it. A simulated camera may not.; see
> [Use a simulated camera](#use-a-simulated-camera).

## Step 2: Create a user for AI Bridge

AI Bridge signs in to XProtect with its own account.

1. In Management Client, go to **Security → Basic Users** and add a user, for example
   `vapuser`. **Remember the password**. You would need that while configuring AI Bridge.
   Also, uncheck **Force Basic User to change password on next login** since login with be done via APIs automatically.
2. Go to **Security → Roles**, and add the user to a role that can see the cameras you
   want to analyze. We added the user to both **AIBridge** and **Administrator**

   To learn more, see AI Bridge docs on [Create a basic user for Milestone AI Bridge](https://doc.milestonesys.com/AIB/Help/latest/en-us/feature_flags/ff_aibridge/aib_adm_configinit_createaibuser.htm)

Use this account when you deploy AI Bridge in Step 4. AI Bridge only lists the cameras
this account can see.

<!-- SCREENSHOT TODO: ../../../_assets/milestone-mc-basic-user.png
     Management Client > Security > Basic Users, with the AI Bridge user selected. -->

## Step 3: Install the Processing Server Admin Plugin

Management Client needs the **Milestone XProtect Processing Server Admin Plugin** to show
AI Bridge apps and their topics.

1. Download `VideoOS.ProcessingServer.Plugin.Admin.Installer.exe` from Milestone.
2. Install it on every machine where Management Client runs.
3. Restart Management Client.

After this, each camera's properties have a **Processing server** tab.

To learn more, see AI Bridge docs on [Install the Milestone XProtect Processing Server Admin Plugin](https://doc.milestonesys.com/AIB/Help/latest/en-us/feature_flags/ff_aibridge/aib_adm_install_mcplugin.htm)

## Step 4: Deploy AI Bridge and attach it to XProtect

1. Download the AI Bridge resources as described
   in the [AI Bridge documentation](https://doc.milestonesys.com/AIB/Help/latest/en-us/). It downloads a zip file that has compose deployment resource along with others.

2. Navigate to the `aibridge_compose_deployment/aws` folder In its configuration. Edit the .env file with the XProtect Management Server address and the AI Bridge host and user credentials from Step 2.

      ```sh
      # XProtect endpoint and credentials (use https to connect with TLS)
      VMS_URL="http://server-name"  # value can be found from checking the Management server address in Milestone Server Configurator
      VMS_USER="vapuser"      # user name created in Step 4
      VMS_PASS="Vapuser@1234" # user password set in Step 4

      # External IP address and hostname through which the AI Bridge services can be reached
      EXTERNAL_IP="<AIB-HOST>"   # AI Bridge HOST IP
      EXTERNAL_HOSTNAME="AIB-HOST"  # AI Bridge HOST IP
      ```

3. For a first setup, run AI Bridge in **debug mode**, so the GraphQL, RTSP and topic
   ports in [Network](#network) are reachable directly.

The machine running the Milestone AI Bridge must be able to access all XProtect machines using machine IP addresses or hostnames. See [Setting up in a proxy environment section](#proxy)

## Step 5: Enable analytics events in XProtect

Loitering events reach XProtect as *analytics events*. XProtect accepts them only when
analytics events are enabled.

1. In Management Client, go to **Tools → Options → Analytics Events**.
2. Tick **Enabled**.
3. If address filtering is on, add the AI Bridge host to the allowed addresses.
4. Click **OK**.

## Step 6: Check AI Bridge

Run these checks from the analytics host, where VAP will run. Replace `<aib-host>`
with the AI Bridge host address.

1. AI Bridge is attached to XProtect. Expect one id for each attached XProtect system:

   ```bash
   curl -s http://<aib-host>:4000/api/bridge/graphql \
     -H 'Content-Type: application/json' \
     -d '{"query":"{ about { videoManagementSystems { id } } }"}'
   ```

   You can expect an output like this-

   ```json
   {
   "data": {
      "about": {
         "videoManagementSystems": [
         {
            "id": "a898a7b5-fee8-46b3-aa13-ec8203f55e0c"
         }
         ]
      }
   }
   }

   ```

2. AI Bridge lists your cameras, with an RTSP address and a resolution for each stream:

   ```bash
   curl -s http://<aib-host>:4000/api/bridge/graphql \
     -H 'Content-Type: application/json' \
     -d '{"query":"{ cameras { name videoStreams { id name streamAvailability { rtsp } videoResolution { width height } } } }"}'
   ```

   You can expect an output like this-

   ```json
   {
      "data": {
         "cameras": [
               {
                  "name": "AXIS P3265-LVE Dome Camera - Camera 1",
                  "videoStreams": [
                     {
                           "id": "3b98c08a-2fb4-4838-b93a-ff484d282c8d/28dc44c3-079e-4c94-8ec9-60363451eb40",
                           "name": "Video stream 1",
                           "streamAvailability": {
                              "rtsp": "rtsp://<AIB_HOST_IP>:8554/3b98c08a-2fb4-4838-b93a-ff484d282c8d/28dc44c3-079e-4c94-8ec9-60363451eb40"
                           },
                           "videoResolution": {
                              "width": 1920,
                              "height": 1080
                           }
                     }
                  ]
               }
         ]
      }
   }
   ```

   An empty list usually means the AI Bridge user cannot see the cameras (Step 2). A
   `null` `videoResolution` means VAP cannot place the zone on that camera; see
   [Use a simulated camera](#use-a-simulated-camera).

3. The restream plays. Use an `rtsp` address from the previous answer:

   ```bash
   ffprobe -rtsp_transport tcp "rtsp://<AIB_HOST_IP>:8554/<deviceId>/<streamId>"
   ```

   `ffprobe` should report an H.264 or H.265 video stream with its resolution.

## Use a simulated camera

Without a real camera, you can loop a video file as an RTSP stream and add it to
XProtect. This is useful for testing, with one limitation: XProtect may not report a
resolution for it, so AI Bridge shows none, VAP logs `od_zone_resolution_unavailable`,
and the pipeline runs with its own default zone instead of the one you set.

1. Serve the video over RTSP, for example with [MediaMTX](https://github.com/bluenviron/mediamtx)
   and FFmpeg:

   ```bash
   docker run -d --name mediamtx -p 8554:8554 bluenviron/mediamtx:<version>
   ffmpeg -re -stream_loop -1 -i <video>.mp4 -c:v copy \
     -bsf:v dump_extra=freq=keyframe -an \
     -f rtsp rtsp://<rtsp-host>:8554/loitering
   ```

   `dump_extra=freq=keyframe` repeats the H.264 stream headers at every key frame, which
   helps XProtect and decoders that join mid-stream. If AI Bridge also runs on this host,
   use a port other than 8554 for MediaMTX.

2. In Management Client, use **Add Hardware → Manual**, choose the **Universal** driver,
   and give it the RTSP address.

3. Repeat the checks in [Step 6](#step-6-check-ai-bridge). If the stream has no
   resolution in AI Bridge, the zone set in VAP is not applied for this camera.

[!IMPORTANT] We strongly recommend using an actual physical camera supported by Milestone XProtect. For our integration development, we used AXIS P3265-LVE Dome Camera.

## Proxy

In a proxied environment, do the following

* add the aibridge containers, host IPs of AI Bridge,VAP and XProtect windows machine to the `~/.docker/config.json`. Restart docker with

   ```sh
   # Restart docker
   $ sudo systemctl daemon-reload
   $ sudo service docker restart
   ```

* set/unset the follwoing proxy variable in the respective services environments in `docker-compose.yml`
  * **AI Bridge docker compose file**

      For each service in the compose file set the following environment variables:

      ```yaml
      HTTP_PROXY: ""
      HTTPS_PROXY: ""
      http_proxy: ""
      https_proxy: ""
      NO_PROXY: "*"
      no_proxy: "*"
      ```

      **Purpose:** These variables disable HTTP/HTTPS proxying inside the containers. This stops proxy settings from the host or Docker daemon, which are common on corporate networks, from being passed into the containers.

      **Why it is needed:** The AI Bridge services (Kafka, ZooKeeper, Fuseki and others) talk to each other by Docker service name over the internal compose network. A corporate proxy cannot resolve these names, so routing the traffic through it would cause connection failures or timeouts.

      Empty HTTP_PROXY and HTTPS_PROXY values clear any inherited proxy. Both uppercase and lowercase forms are set because different tools read different forms.
      NO_PROXY="*" tells client libraries to bypass the proxy for all destinations, as a second safeguard.

  * **VAP docker compose file**

      For vms-adapter-backend service, add the AI Bridge host IP (defined by `AIB_HOST` envvar) to the no_proxy and NO_PROXY environment variables.

      ```yaml
      services:
         backend:
            environment:
               no_proxy: ${AIB_HOST:-} #append
               NO_PROXY: ${AIB_HOST:-} #append
      ```

## Next step

[Run Loitering Detection with XProtect](./get-started.md).
